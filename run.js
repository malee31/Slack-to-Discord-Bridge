/**
 * @file run.js is the root file that starts everything up and handles everything.
 * See the{@link module:Start| run.js documentation} for more information. (It has been renamed the Start module for documentation purposes)
 * @author Marvin Lee
 */

/**
 * The root file for the project
 * @module Start
 */

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

// Prevents script from stopping on errors
slackEvents.on("error", err => {
	console.warn("Something went wrong with the Slack Web API");
	console.error(err);
});

/**
 * Creates a basic embed template with the Slack user's profile picture, name, and message timestamp
 * @param {Object} user User object obtained through Slack's users.info endpoint
 * @param {number} time Timestamp from the Slack message. Can be obtained from event.ts
 * @returns {MessageEmbed} Blank user embed template
 */
function userMessageEmbed(user = {}, time) {
	return new Discord.MessageEmbed()
		.setAuthor(discordManager.userIdentify(user), user.profile?.image_512 || "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif")
		.setColor(user.color ?? "#407ABA")
		.setTimestamp(time * 1000);
}

/**
 * Converts some Slack auto-embeds into Discord embeds
 * @param {Object} embed The Slack embed to parse
 * @returns {MessageEmbed} The resulting Discord embed
 */
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

/**
 * Starts up the script by initializing all the necessary variables in all the JS files and completing start-up tasks
 * @returns {Promise<Array.<*>>} Returns a Promise.all with an array of all the setup and start-up functions' results (Usually undefined)
 */
function startUp() {
	console.log("============= Starting Up =============");
	console.log("============ Checking .env ============");
	if(process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE !== "SLACK_BOT_USER_OAUTH_ACCESS_TOKEN" && process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE !== "SLACK_USER_OAUTH_ACCESS_TOKEN") {
		console.log("============== Bad .env ===============");
		console.error(`SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE not set to either SLACK_BOT_USER_OAUTH_ACCESS_TOKEN or SLACK_USER_OAUTH_ACCESS_TOKEN\nPlease set it properly and try again\nCurrent Value: ${process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE}`);
		process.exit(1);
	}
	console.log("============ Checked  .env ============");

	const pendingPromises = [];

	// Can Disable With Environment Variable
	if(process.env.DISABLE_CHANNEL_JOIN?.trim().toUpperCase() !== "TRUE") {
		pendingPromises.push(web.conversations.list().then(channelList => {
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

/**
 * The part of the logging process where the final attachments are parsed and embeds are sent out
 * @async
 * @param {TextChannel} targetChannel Discord channel to send the embeds to
 * @param {MessageEmbed[]} embeds Array of parsed embeds to send to channel
 * @param {Object[]} [attachments] Array of attachments from Slack. Can be obtained from event.attachments
 * @param {string} slackChannelID The Slack channel ID that the messages originated from
 * @param {string|number} slackTs Timestamp of the message from Slack
 * @returns {Promise<Message[]>} Returns the array of resulting messages from sending the embeds to Discord
 */
async function standardOperations(targetChannel, embeds, attachments, slackChannelID, slackTs) {
	if(attachments) {
		// console.log(attachments);
		for(const messageAttachment of attachments) {
			embeds.push(slackEmbedParse(messageAttachment));
		}
	}
	return await discordManager.embedSender(targetChannel, embeds, discordManager.identify(slackChannelID, slackTs));
}

// Starts up the logger
startUp().then(() => {
	console.log("========== Start Up Complete ==========");
	// Attaches event listener that parses received messages
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
			let threadMainURL = `https://discord.com/channels/${discordManager.loggingGuild.id}/${targetChannel.id}/${(await databaseManager.locateMaps(discordManager.identify(event.channel, event.thread_ts)))[0]["DiscordMessageID"]}`;
			embeds[0].setDescription(`[<Replied to This Message>](${threadMainURL})\n${embeds[0].description || ""}`);
		}

		// Note: Some of these subtypes might either not exist or have another method of capture since they don't appear to trigger here
		switch(event.subtype) {
			case "bot_message":
				console.warn("BOT MESSAGE - ABORT");
				console.log(event);
				break;
			case "message_deleted":
				await discordManager.delete(targetChannel, discordManager.identify(event.channel, event.previous_message.ts))
				break;
			case "message_changed":
				// Known bugs:
				// * Does not handle file deletions. For those, delete the entire message instead of just the file itself in order to remove it
				// * Attachments are only parsed again if there were no attachments before but there are now. This means that if an attachment is somehow added in an edit and there was already an attachment before, they are ignored.
				//     * Situations in which this will happen have not been found yet
				// * Attachments may break the order of the logged messages if they process themselves faster than the main embed
				// * Changes that occur before the original message has had a chance to be bridged over may crash the program (It won't shutdown though, it'll just leave a messy error message)

				// Removes default main embed
				embeds.shift();

				// Handles changes in text content
				if(event.message.text !== event.previous_message.text) {
					await discordManager.textUpdate(targetChannel, discordManager.identify(event.channel, event.previous_message.ts), event.message.text)
				}

				// Deals with Slack URLs Unfurl Embeds (May cause bugs if other types of messages have attachments too)
				if(Array.isArray(event.message.attachments) && !event.previous_message.attachments) {
					for(const messageAttachment of event.message.attachments) {
						embeds.push(slackEmbedParse(messageAttachment));
					}
				}
				await discordManager.embedSender(targetChannel, embeds, discordManager.identify(event.channel, event.ts), false);
				break;
			case "file_share":
				// Download the files, send the files (with the text), and then delete the files that are sent. Keeps the ones that are too large to send
				let downloads = await discordManager.attachmentEmbeds(embeds, event.files);
				await discordManager.embedSender(targetChannel, embeds, discordManager.identify(event.channel, event.ts));
				await Promise.all(downloads
					// Comment out the line below if you would not like to keep files 8MB or larger on your webserver
					.filter(download => download.path !== fileManager.FAILED_DOWNLOAD_IMAGE_PATH && download.size < 8)
					.map(download => fileManager.fileDelete(download.path))
				);
				break;
			case "message_replied":
				console.warn("Received a 'message_replied' event. This is just a thread and it should be working fine.\nJust note that if you see this: There was a bug alert for this subtype that said to check for event.thread_ts instead of using event.subtype to tell if the message is part of a thread. If you see this, it means that it has since been patched and the code should be updated");
			/* No Support Added for Groups. If a default channel is being used, there is a chance that the code will still work for groups to some degree if this is uncommented but there are no guarantees
			case "group_join":
			case "group_leave":
			case "group_archive":
			case "group_unarchive":
			case "group_name":
			case "group_purpose":
			case "group_topic": */
			case "me_message": // It's just regular text in italics isn't it??? I'm not going to bother to italicize it
			case "thread_broadcast": // Is a message AND a thread... Oh no...
			case undefined:
				await standardOperations(targetChannel, embeds, event.attachments, event.channel, event.ts);
				break;
			case "channel_topic":
				await targetChannel.setTopic(event.topic);
			case "channel_join":
			case "channel_leave":
			case "channel_archive":
			case "channel_unarchive":
			case "channel_purpose":
				(await standardOperations(targetChannel, embeds, event.attachments, event.channel, event.ts)).forEach(message => {
					message.pin({reason: "Channel Metadata Change"});
				});
				break;
			case "channel_name":
				(await standardOperations(targetChannel, embeds, event.attachments, event.channel, event.ts)).forEach(message => {
					message.pin({reason: "Channel Metadata Change"});
				});
				console.log(`Renaming "#${event.old_name}" to "#${event.name}"`);
				await targetChannel.setName(event.name, "Channel Metadata Change");
				console.log(`Successfully Renamed "#${event.old_name}" to "#${event.name}"`);
				break;
			default:
				console.warn(`Unknown Message Subtype ${event.subtype}`);
		}
	});

	slackEvents.on("pin_added", async event => {
		await discordManager.setPin(true, event.item.channel, event.user, event.item.message.ts);
	});

	slackEvents.on("pin_removed", async event => {
		await discordManager.setPin(false, event.item.channel, event.user, event.item.message.ts);
	});
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});