require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const databaseManager = require("./databaseManager.js");
const discordManager = require("./discordManager.js");
const fileManager = require("./fileManager.js");
const {WebClient} = require("@slack/web-api");
const Discord = require("discord.js");
const http = require("http");

// Initialize a server using the event adapter's request listener
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = http.createServer(slackEvents.requestListener());
const web = new WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
let botAuthData;

slackEvents.on("message", async event => {
	if((event["bot_id"] && event["bot_id"] === botAuthData["bot_id"]) || (event.user && event.user === botAuthData.user_id)) return;

	if(event.text && event.text.toLowerCase() === "sql_test") {
		console.log("SQL TEST DETECTED");
		databaseManager.dataDump();
	}

	const targetChannel = await discordManager.locateChannel(web, event.channel);
	const user = (event.user ? (await web.users.info({user: event.user})).user : undefined);
	const embeds = [userMessageEmbed(user, event.ts)];

	// Default Text Assembly
	if(event.text) embeds[0].setDescription(await discordManager.slackTextParse(web, event.text));

	switch(event.subtype) {
		case "bot_message":
			console.warn("BOT MESSAGE - ABORT");
			break;
		case "message_replied":
			console.log("God, replies! Thank god nearly no one uses it");
			break;
		case "message_deleted":
			await Promise.all((await databaseManager.locateMaps(identify(event.channel, event.previous_message.ts))).map(async DMID => {
				let message = await targetChannel.messages.fetch(DMID["DiscordMessageID"]);
				await message.delete();
			}));
			break;
		case "message_changed":
			// TODO: Actually edit messages if the text changes
			console.log("Message Change");
			embeds.shift();
			for(const messageAttachment of event.message.attachments) {
				embeds.push(slackEmbedParse(messageAttachment));
			}
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			break;
		case "file_share":
			let downloads = await attachmentEmbeds(embeds, event.files);
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			await Promise.all(downloads.map(downloadPath => fileManager.fileDelete(downloadPath.path)));
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
			// No support for groups yet*/
		case "me_message": // It's just regular text in italics isn't it???
		case "reply_broadcast": // Deprecated/Removed. It's the same as thread_broadcast
		case "thread_broadcast": // Is a message AND a thread... Oh no...
		case undefined:
			// Standard Text Message Embed Already Handled Pre-Switch Statement
			await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			if(event.attachments) {
				console.log(event.attachments);
				for(const messageAttachment of event.attachments) {
					await targetChannel.send(slackEmbedParse(messageAttachment));
				}
			}
			break;
		default:
			console.warn(`Unknown Message Subtype ${event.subtype}`);
	}
});

const attachableFormats = ["png", "jpg", "jpeg"];
// Removed from attachable formats because audio formats auto-embed themselves (Wow flac files are huge!): ["mp3", "ogg", "wav", "flac"]
// Removed from attachable formats because video formats auto-embed themselves then fail to load (Still available via "Open Original" download link): ["mov", "webm", "mp4"]
// Do not work with embeds (Also, apparently "gifv" is not real): ["gif"]
async function attachmentEmbeds(embedArr, slackFiles) {
	let downloads = [];
	console.log("ATTEMPTING FILE DOWNLOAD");
	for(const fileObj of slackFiles) {
		downloads.push(fileManager.fileDownload(fileObj));
	}

	downloads = await Promise.all(downloads);

	let sliceNum = 1;

	if(attachableFormats.includes(downloads[0].extension.toLowerCase().trim()) && await fileManager.fileSize(downloads[0].path) >= 8) {
		embedArr[0].attachFiles({
			attachment: downloads[0].path,
			name: downloads[0].name
		}).setImage(`attachment://${downloads[0].name}`);
	} else {
		sliceNum = 0;
	}

	if(downloads.length > sliceNum) {
		await Promise.all(downloads.slice(sliceNum).map(async file => {
			let newFileEmbed = new Discord.MessageEmbed()
				.setColor(embedArr[0].color)
				.setTimestamp(embedArr[0].timestamp);

			// Discord File Upload Size Caps at 8MB Without Nitro Boost
			// Increase Value if Logging Server is Boosted
			if(await fileManager.fileSize(file.path) < 8) {
				if(attachableFormats.includes(file.extension.toLowerCase().trim())) {
					newFileEmbed.attachFiles({
						attachment: file.path,
						name: file.name
					}).setImage(`attachment://${file.name}`);
				} else {
					newFileEmbed = {
						files: [{
							attachment: file.path,
							name: file.name
						}]
					};
				}
			} else {
				newFileEmbed.setTitle(file.name);
				newFileEmbed.setDescription(`[File Too Large to Send](${file.original.url_private})`);
			}
			embedArr.push(newFileEmbed);
		}));
	}

	return downloads;
}

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