/**
 * @file run.js is the root file that starts everything up and handles everything.
 * See the{@link module:Start| run.js documentation} for more information. (Named the Start module for documentation purposes)
 * @author Marvin Lee
 */

/**
 * The root file for the project
 * @module Start
 */

require("dotenv").config();
const databaseManager = require("./databaseManager.js");
const DiscordManager = require("./discordManager.js");
const SlackManager = require("./slackManager.js");

// Initialize a server using the event adapter's request listener
const server = require("./fileServer.js")(SlackManager.SlackHTTPServerEventAdapter);

/**
 * Starts up the script by initializing all the necessary variables in all the JS files and completing start-up tasks
 * @returns {Promise<Array>} Returns a Promise.all with an array of all the setup and start-up functions' results (Usually undefined)
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

	return Promise.all([
		SlackManager.start(),
		DiscordManager.start(),
		new Promise((resolve, reject) => {
			server.listen(Number(process.env.PORT) || 3000, err => {
				if(err) reject(err);
				console.log(`========== Started Port ${server.address().port} ==========`);
				resolve();
			});
		}),
	]);
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
 * The part of the logging process where the final attachments are parsed and embeds are sent out
 * @async
 * @param {TextChannel} targetChannel Discord channel to send the embeds to
 * @param {MessageOptions[]} payloads Array of parsed embeds to send to channel
 * @param {Object[]} [attachments] Array of attachments from Slack. Can be obtained from event.attachments
 * @param {string} slackChannelID The Slack channel ID that the messages originated from
 * @param {string|number} slackTs Timestamp of the message from Slack
 * @returns {Promise<Message[]>} Returns the array of resulting messages from sending the embeds to Discord
 */
async function standardOperations(targetChannel, payloads, attachments, slackChannelID, slackTs) {
	if(attachments) {
		// console.log(attachments);
		for(const messageAttachment of attachments) {
			payloads.push({ embeds: [slackEmbedParse(messageAttachment)], files: [] });
		}
	}
	return DiscordManager.embedSender(targetChannel, payloads, DiscordManager.identify(slackChannelID, slackTs));
}

// Starts up the logger
startUp().then(() => {
	console.log("========== Start Up Complete ==========");

	// Attaches event listener that parses received messages

	slackEvents.on("pin_added", async event => {
		await DiscordManager.setPin(true, event.item.channel, event.user, event.item.message.ts);
	});

	slackEvents.on("pin_removed", async event => {
		await DiscordManager.setPin(false, event.item.channel, event.user, event.item.message.ts);
	});
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});