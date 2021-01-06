require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const databaseManager = require("./databaseManager.js");
const discordManagerClass = require("./discordManager.js");
const fileManager = require("./fileManager.js");
const {WebClient} = require("@slack/web-api");
const Discord = require("discord.js");
const mime = require("mime-types");
const http = require("http");
const path = require("path");
const fs = require("fs");

// Initialize a server using the event adapter's request listener
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = http.createServer((req, res) => {
	if(req.url === "/slack/events") {
		slackEvents.requestListener()(req, res);
	} else {
		const filePath = path.resolve(__dirname, "downloads", `.${req.url}`);
		if(filePath === path.resolve(__dirname, "downloads")) {
			fs.readdir(filePath, (err, files) => {
				if(err) {
					console.warn("Error Reading Downloads Folder");
					res.writeHead(500, {"Content-Type": "text/plain"});
					res.write(`Error Reading Downloads Folder: \n${err}`);
					res.end();
					return;
				}
				res.writeHead(200, {"Content-Type": "text/plain"});
				res.write(`Download Folder Contents:\n`);
				files.forEach(file => {
					res.write(`${file}\n`);
				});
				res.end();
			});
			return;
		}
		fs.readFile(filePath, (err, data) => {
			if(err) {
				console.warn(`Error reading file from downloads: ${err}`);
				res.writeHead(200, {"Content-Type": "text/plain"});
				res.write(`Error reading file from downloads (${filePath}): \n${err}`);
				res.end();
				return;
			}
			const contentType = mime.lookup(filePath);
			res.writeHead(200, {"Content-Type": contentType ? contentType : false});
			res.end(data, "UTF-8");
		});
	}
});
const web = new WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
const discordManager = new discordManagerClass(web);
let botAuthData;

slackEvents.on("message", async event => {
	if((event["bot_id"] && event["bot_id"] === botAuthData["bot_id"]) || (event.user && event.user === botAuthData.user_id)) return;

	if(event.text && event.text.toLowerCase() === "sql_test") {
		console.log("SQL TEST DETECTED");
		databaseManager.dataDump();
	}

	const targetChannel = await discordManager.locateChannel(event.channel);
	const user = (event.user ? (await web.users.info({user: event.user})).user : undefined);
	const embeds = [userMessageEmbed(user, event.ts)];

	// Default Text Assembly
	if(event.text) embeds[0].setDescription(await discordManager.slackTextParse(event.text));

	// Note: Some of these subtypes might either not exist or have another method of capture since they don't appear to trigger here
	switch(event.subtype) {
		case "bot_message":
			console.warn("BOT MESSAGE - ABORT");
			break;
		case "message_replied":
			console.log("God, replies! Thank god nearly no one uses it");
			break;
		case "message_deleted":
			await discordManager.delete(targetChannel, identify(event.channel, event.previous_message.ts))
			break;
		case "message_changed":
			// Removes default main embed
			embeds.shift();

			// Handles text content changes
			if(event.message.text !== event.previous_message.text) {
				await discordManager.textUpdate(targetChannel, identify(event.channel, event.previous_message.ts), event.message.text)
			}

			// For when Slack Auto-Embeds URLs
			if(Array.isArray(event.message.attachments) && !event.previous_message.attachments) {
				for(const messageAttachment of event.message.attachments) {
					embeds.push(slackEmbedParse(messageAttachment));
				}
			}
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts), false);
			break;
		case "file_share":
			// Download the files, send the files (and the text), and then delete the files
			let downloads = await discordManager.attachmentEmbeds(embeds, event.files);
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			await Promise.all(downloads
				.filter(download => download.size < 8)
				.map(download => fileManager.fileDelete(download.path))
			);
			break;
		// Possible Bug: The <@U######|cal> format may bug out the user parsing code
		case "pinned_item": // TODO: Pin it on Discord too
			console.log("Pin!");
		case "unpinned_item": // TODO: Unpin it on Discord too
			console.log("Unpin!");
		case "channel_join":
		case "channel_leave":
		case "channel_archive":
		case "channel_unarchive":
		case "channel_name":
		case "channel_purpose":
		case "channel_topic":
		// TODO: Actually update the channel on Discord too
		//  No need to rush on this task since it rarely happens and the channels will still be serverMapped
		case "file_comment":
		// No idea what that does
		case "file_mention":
		/*case "group_join":
		case "group_leave":
		case "group_archive":
		case "group_unarchive":
		case "group_name":
		case "group_purpose":
		case "group_topic":
			// No support for groups*/
		case "me_message": // It's just regular text in italics isn't it??? I'm not going to bother to italicize it
		case "reply_broadcast": // Deprecated/Removed. It's the same as thread_broadcast
		case "thread_broadcast": // Is a message AND a thread... Oh no...
		case undefined:
			// Standard Text Message Embed Already Handled Pre-Switch Statement
			if(event.attachments) {
				console.log(event.attachments);
				for(const messageAttachment of event.attachments) {
					embeds.push(slackEmbedParse(messageAttachment));
				}
			}
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			break;
		default:
			console.warn(`Unknown Message Subtype ${event.subtype}`);
	}
});

slackEvents.on("error", err => {
	console.warn("Something went wrong with the Slack Web API");
	console.error(err);
});

function userMessageEmbed(user = {}, time) {
	const userEmbed = new Discord.MessageEmbed()
		.setAuthor(discordManager.userIdentify(user), (user.profile && user.profile["image_512"] ? user.profile["image_512"] : "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif"))
		.setColor(`#${user.color || "283747"}`);
	if(time) userEmbed.setTimestamp(time * 1000);
	return userEmbed;
}

function slackEmbedParse(embed = {}) {
	let discordEmbed = new Discord.MessageEmbed();
	if(embed.title) discordEmbed
		.setTitle(embed.title)
		.setURL(embed.title_link);

	discordEmbed
		.setDescription(embed.text || embed.fallback)
		.setImage(embed.image_url)
		.setAuthor(embed["service_name"] || embed["author_name"] || "Unknown Pupper", embed["service_icon"] || embed["author_icon"], embed["original_url"] || embed["author_link"]);
	if(embed.color) discordEmbed.setColor(`#${embed.color}`);
	if(embed.footer) discordEmbed.setFooter(embed.footer);
	return discordEmbed;
}

// Use on a Slack event to generate an id for messages that SHOULD be unique (No official documentation found)
function identify(channel, ts) {
	return `${channel}/${ts}`;
}

async function startUp() {
	console.log("============= Starting Up =============");
	const pendingPromises = [];
	pendingPromises.push(await web.conversations.list().then(channelList => {
		for(const channel of channelList.channels) {
			if(channel["is_channel"] && !channel["is_member"]) pendingPromises.push(web.conversations.join({channel: channel.id}));
		}
		console.log("======== Slack Channels Joined ========");
	}));

	pendingPromises.push(web.auth.test().then(auth => {
		botAuthData = auth;
		console.log("======= Slack App Data Retrieved ======");
	}))

	server.listen(Number(process.env.PORT) || 3000, () => {
		console.log(`========== Started Port ${server.address().port} ==========`);
	});

	pendingPromises.push(discordManager.start());

	return Promise.all(pendingPromises);
}

startUp().then(() => {
	console.log("========== Start Up Complete ==========");
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});