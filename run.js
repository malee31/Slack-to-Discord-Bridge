require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const databaseManager = require("./databaseManager.js");
const discordManagerClass = require("./discordManager.js");
const fileManager = require("./fileManager.js");
const {WebClient} = require("@slack/web-api");
const Discord = require("discord.js");

// Initialize a server using the event adapter's request listener
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = require("./fileServer.js")(slackEvents);

const web = new WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);

const discordManager = new discordManagerClass(web);
let botAuthData;

slackEvents.on("error", err => {
	console.warn("Something went wrong with the Slack Web API");
	console.error(err);
});

function userMessageEmbed(user = {}, time) {
	return new Discord.MessageEmbed()
		.setAuthor(discordManager.userIdentify(user), user.profile?.image_512 || "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif")
		.setColor(user.color ?? "#407ABA")
		.setTimestamp(time * 1000);
}

function slackEmbedParse(embed = {}) {
	let discordEmbed = new Discord.MessageEmbed();
	if(embed.title) discordEmbed
		.setTitle(embed.title)
		.setURL(embed.title_link);

	discordEmbed
		.setDescription(embed.text || embed.fallback)
		.setImage(embed.image_url)
		.setAuthor(embed["service_name"] || embed["author_name"] || "Unknown Pupper", embed["service_icon"] || embed["author_icon"] || "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif", embed["original_url"] || embed["author_link"])
		.setColor(embed.color ?? "#407ABA");
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

	// Can Disable With Environment Variable
	if(process.env.DISABLE_CHANNEL_JOIN?.trim().toUpperCase() !== "TRUE") {
		pendingPromises.push(await web.conversations.list().then(channelList => {
			for(const channel of channelList.channels) {
				if(channel["is_channel"] && !channel["is_member"]) pendingPromises.push(web.conversations.join({channel: channel.id}));
			}
			console.log("======== Slack Channels Joined ========");
		}));
	}

	// Only needed if bot sends messages to Slack
	if(process.env.DISABLE_BOT_INFO_LOOKUP?.trim().toUpperCase() !== "TRUE") {
		pendingPromises.push(web.auth.test().then(auth => {
			botAuthData = auth;
			console.log("======= Slack App Data Retrieved ======");
		}));
	}

	server.listen(Number(process.env.PORT) || 3000, () => {
		console.log(`========== Started Port ${server.address().port} ==========`);
	});

	pendingPromises.push(discordManager.start());

	return Promise.all(pendingPromises);
}

startUp().then(() => {
	console.log("========== Start Up Complete ==========");
	slackEvents.on("message", async event => {
		if(process.env.DISABLE_BOT_INFO_LOOKUP?.trim().toUpperCase() !== "TRUE") {
			if(event.bot_id === botAuthData.bot_id || event?.user === botAuthData.user_id) return;
		}

		const targetChannel = await discordManager.locateChannel(event.channel);
		const user = event.user ? (await web.users.info({user: event.user})).user : undefined;
		const embeds = [userMessageEmbed(user, event.ts)];

		// Default Text Assembly
		if(event.text) {
			if(event.text.toUpperCase() === "SQL_DUMP") databaseManager.dataDump();
			embeds[0].setDescription(await discordManager.slackTextParse(event.text));
		}
		// Get Link to First Message in Thread
		if(event.thread_ts) {
			let threadMainURL = `https://discord.com/channels/${discordManager.loggingGuild.id}/${targetChannel.id}/${(await databaseManager.locateMaps(identify(event.channel, event.thread_ts)))[0]["DiscordMessageID"]}`;
			embeds[0].setDescription(`[<Replied to This Message>](${threadMainURL})\n${embeds[0].description || ""}`);
		}

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
				// Download the files, send the files (with the text), and then delete the files that are sent. Keeps the ones that are too large to send
				let downloads = await discordManager.attachmentEmbeds(embeds, event.files);
				await discordManager.embedSender(targetChannel, embeds, identify(event.channel, event.ts));
				await Promise.all(downloads
					// Comment out the line below if you would not like to keep files 8MB or larger on your webserver
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
					// console.log(event.attachments);
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
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});