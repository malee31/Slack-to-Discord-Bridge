const databaseManager = require("./databaseManager.js");
const dataManager = require("./dataManager.js");
const fileManager = require("./fileManager.js");
const Discord = require("discord.js");

/**
 * Slack's HTTP client for making requests to Slack’s Web API
 * @external WebClient
 * @see https://slack.dev/node-slack-sdk/web-api
 */

class DiscordManager {
	// Removed from attachable formats because audio formats auto-embed themselves (Wow flac files are huge!):
	// Removed from attachable formats because video formats auto-embed themselves then fail to load (Still available via "Open Original" download link):
	// Do not work with embeds (Also, apparently "gifv" is not real): ["gif"]
	static attachableFormats = ["png", "jpg", "jpeg"];
	// noinspection JSCheckFunctionSignatures
	static client = new Discord.Client({ intents: require("./Intents.js") });
	static LoggingGuild;

	/**
	 * Starts up the Discord Bot responsible for logging messages, locates the logging guild, and loads the serverMap.json to (dataManager.js).load()
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 */
	static async start() {
		// Start up Discord Bot
		await DiscordManager.client.login(process.env.DISCORD_TOKEN);
		DiscordManager.client.once("disconnect", () => {
			console.log("======= Disconnecting. Goodbye! =======");
			process.exit(1);
		});
		this.client.user.setPresence({
			activities: [{
				type: "LISTENING",
				name: "Slack Messages"
			}],
			status: "online",
			afk: false
		});
		console.log(`===== Logged in as ${this.client.user.tag} ====`);

		try {
			console.log("======= Locating Logging Server =======");
			DiscordManager.LoggingGuild = await this.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
		} catch(locateError) {
			console.warn("⚠⚠ Failed to Locate Logging Server ⚠⚠");
			console.error(locateError);
			process.exit(1);
		}

		console.log("===== Retrieving Saved Server Map =====");
		await dataManager.load();
		console.log("====== Saved Server Map Retrieved =====");

		console.log("========== Discord Bot Ready ==========");
	}

	/**
	 * Does not handle attachments. Only top level data (depth of 1) for a syntax tree
	 * @param syntaxTree
	 */
	static embedFromSyntaxTree(syntaxTree) {
		const parsedEmbed = new Discord.MessageEmbed();

		parsedEmbed.setColor(syntaxTree.color);
		parsedEmbed.setAuthor(syntaxTree.name, syntaxTree.profilePic);
		parsedEmbed.setDescription(this.syntaxTreeParseText(syntaxTree));
		parsedEmbed.setTimestamp(syntaxTree.timestamp * 1000);

		return { embeds: [parsedEmbed] };
	}

	static embedFromFile(file, templateEmbed) {
		if(!templateEmbed instanceof Discord.MessageEmbed) throw new TypeError("Template Embed Required");

		const result = {
			embeds: [],
			files: []
		};

		const fileEmbed = new Discord.MessageEmbed()
			.setColor(templateEmbed.color)
			.setTimestamp(templateEmbed.timestamp * 1000);

		if(file.size < 8) {
			if(this.attachableFormats.includes(file.extension.toLowerCase().trim()))
				result.embeds.push(fileEmbed.setImage(`attachment://${file.name}`));

			result.files.push({
				attachment: file.path,
				name: file.name
			});
		} else {
			fileEmbed.setTitle(file.name);
			let serverURLText = `[Copy Saved on Server as: /${file.storedAs}]`;
			if(process.env.SERVER_URL) serverURLText += `\n(${process.env.SERVER_URL}/${encodeURIComponent(file.storedAs)})`;
			result.embeds.push(fileEmbed.setDescription(`[File Too Large to Send](${file.original.url_private})${serverURLText}`));
		}

		console.log(result)

		return result;
	}

	static syntaxTreeParseText(syntaxTree) {
		if(syntaxTree.unparsedText.length === 0) return "[No Message Contents]";
		let parsedText = syntaxTree.unparsedText;

		// TODO: Parse channels and mentions
		// Regex differs slightly from official regex defs_user_id in https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json
		// Known Bugs:
		// * Slow. Each mention slows down parsing significantly back in the MessageSyntaxTree assembly stage
		// let mentions = text.match(/(?<=<@)[UW][A-Z0-9]{8}([A-Z0-9]{2})?(?=>)/g);
		// if(mentions) {
		// 	let identify = mentions.filter((id, index) => mentions.indexOf(id) === index).map(id => {
		// 		return DiscordManager.SlackClient.users.info({ user: id });
		// 	});
		// 	(await Promise.all(identify)).forEach(userInfo => {
		// 		text = text.replace(new RegExp(`<@${userInfo.user.id}>`, 'g'), `[${this.userIdentify(userInfo.user)}]`);
		// 	});
		// }

		// URL Slack to Discord Markdown Translation
		// Known Bugs:
		// * Including the character '>' in any part of the link's text will make the translation cut off early
		// * Certain non-urls will not parse correctly for some odd reason. For example, Slack will try to auto-encode text into a URL if it is entered as one and that won't sit well with Discord
		let urls = parsedText.match(/(?<=<)https?:\/\/[\w@:%.\/+~#=]+(|.+?)?(?=>)/g);
		if(urls) {
			urls.map(link => {
				let split = link.split("|");
				parsedText = parsedText.replace(`<${link}>`, `[${split[1] && split[1].trim().length > 0 ? split[1].trim() : split[0]}](${split[0]})`);
			});
		}

		// Simple Slack to Discord Markdown Translation
		// Known Bugs:
		// * Using Ctrl + Z on Slack to undo any markdown results in that undo being ignored on Discord. Escaped markdown is parsed as if it was never escaped
		// * Formatting markdown using the format buttons instead of actual markdown means that results may not reflect what is seen on Slack
		// Strikethrough Translation
		parsedText = parsedText.replace(/~~/g, "\\~\\~").replace(/(?<=^|\s)(~(?=[^\s])[^~]+(?<=[^\s])~)(?=$|\s)/g, "~$1~");
		// Italic Translation (Untested)
		parsedText = parsedText.replace(/(?<=^|\s)_((?=[^\s])[^_]+(?<=[^\s]))_(?=$|\s)/g, "*$1*");
		// Bold Translation (Untested)
		parsedText = parsedText.replace(/(?<=^|\s)(\*(?=[^\s])[^_]+(?<=[^\s])\*)(?=$|\s)/g, "*$1*");

		// Unescaping HTML Escapes created by Slack's API
		// Known Bugs:
		// * Literally typing any of the following HTML escape codes normally will result in them being converted over to their unescaped form on Discord
		// - Typing &gt; on Slack translates to > on Discord
		// - Typing &lt; on Slack translates to < on Discord
		// - Typing &amp; on Slack translates to & on Discord
		parsedText = parsedText.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

		// Additional Known Bugs:
		// * When using code blocks, the first word is invisible when sent to Discord if it is the only word on the line with the opening ``` since it is parsed as a programming language instead of text by Discord
		// console.log(parsedText);
		return parsedText;
	}

	static async handleSyntaxTree(syntaxTree) {
		const mainEmbed = this.embedFromSyntaxTree(syntaxTree);
		const parsedMessage = {
			mainEmbed,
			// Format in {embed, files}
			additionalEmbeds: syntaxTree.attachments.files
				.map(file => this.embedFromFile(file, mainEmbed))
		};

		syntaxTree.attachments.embeds
			.map(this.embedFromSyntaxTree)
			.forEach(parsedMessage.additionalEmbeds.push);

		const targetChannel = await this.locateChannel(syntaxTree);

		switch(syntaxTree.action) {
			case "send":
				if(parsedMessage.additionalEmbeds.length !== 0) mainEmbed.embeds[0].setFooter(`${mainEmbed.embeds[0].footer ? `${mainEmbed.embeds[0].footer}\n` : ""}↓ Message Includes ${parsedMessage.additionalEmbeds.length} Additional Attachment${parsedMessage.additionalEmbeds.length === 1 ? "" : "s"} Below ↓`)
				const sentMessage = await targetChannel.send(mainEmbed);
				const messageIDs = [];
				await databaseManager.messageMap({
					SMID: syntaxTree.timestamp,
					DMID: sentMessage.id,
					textOnly: true
				}).then(() => {
					console.log(`Mapped Slack ${syntaxTree.timestamp} to Discord ${sentMessage.id}`);
				}).catch(err => {
					console.warn(`MAP ERROR:\n${err}`)
				});

				for(const additionalData of parsedMessage.additionalEmbeds)
					messageIDs.push(await targetChannel.send(additionalData)
						.then(message => message.id)
					);

				await Promise.all(messageIDs.map(id =>
					databaseManager.messageMap({
						SMID: syntaxTree.timestamp.toString(),
						DMID: id,
						textOnly: false
					}).then(() => {
						console.log(`Mapped Slack ${syntaxTree.timestamp} to Discord ${id}`);
					}).catch(err => {
						console.warn(`MAP ERROR:\n${err}`)
					}))
				);
				break;
			case "edit":
				const originalMessageID = (await databaseManager.locateMaps(syntaxTree.timestamp.toString())).find(map => map.PurelyText);
				if(!originalMessageID) return console.warn(`Old Message Not Found For ${syntaxTree.timestamp}`);
				const originalMessage = await targetChannel.messages.fetch(originalMessageID.DiscordMessageID);
				await originalMessage.edit({ embeds: [mainEmbed] });
				break;
			case "delete":
				// Note: Deletes all parts of a message on Discord even if only a part is deleted on Slack (like a singular file)
				// TODO: Delete only what is necessary
				await Promise.all((await databaseManager.locateMaps(syntaxTree.additional.deletedTimestamp))
					.map(async map => {
						const message = await targetChannel.messages.fetch(map["DiscordMessageID"]);
						await message.delete();
					}));
				break;
			case "update-channel-data":
				break;
			case "update-channel-name":
				break;
			case "update-channel-topic":
				break;
			default:
				console.log(`Unknown action: ${syntaxTree.action}`);
		}

		// Clean-up downloaded files after sending
		await Promise.all(
			syntaxTree.attachments.files
				.filter(file => file.size < 8)
				.map(file => fileManager.fileDelete(file.path))
		);
	}

	/**
	 * Locates a channel given a Slack Channel ID. Will grab associated channel from the serverMap.json or search by name. If it does not exist, the bot will create a channel with a matching name and serverMap it
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} slackChannelID The Slack Channel id. Can be obtained through event.channel
	 * @return {TextChannel} Returns the located Discord channel
	 */
	static async locateChannel(syntaxTree) {
		// TODO: Patch function
		let targetChannel = await DiscordManager.LoggingGuild.channels.fetch(dataManager.getChannel(syntaxTree.parseData.channel.id));
		console.log(syntaxTree.parseData.channel, dataManager.getChannel(syntaxTree.parseData.channel.id))
		if(!targetChannel) {
			const channelInfo = await DiscordManager.SlackClient.conversations.info({ channel: syntaxTree.parseData.channel.id });
			if(!channelInfo.channel) {
				console.warn("No channelInfo.channel found: ", channelInfo);
				channelInfo.channel = { name: "unknown_channel_name" };
			}
			if(!channelInfo.channel.name) {
				console.warn("No channelInfo.channel.name found: ", channelInfo.channel);
				channelInfo.channel.name = "unknown_channel_name";
			}
			// Quirk: First occurrence of channel with the same name on Discord is used. The second occurrence is ignored
			targetChannel = (await DiscordManager.LoggingGuild.channels.fetch())
				.find(channel => channel.type === "text" && channel.name === channelInfo.channel.name);

			if(!targetChannel) {
				try {
					targetChannel = await DiscordManager.LoggingGuild.channels.create(channelInfo.channel.name, { reason: `#${channelInfo.channel.name} created for new Slack Messages` });
				} catch(channelMakeErr) {
					// Use the line below instead of throwing if there is a default channel listed in serverMap.json you would like to send to instead of throwing
					// return DiscordManager.LoggingGuild.channels.fetch(dataManager.getChannel(event.channel, true));
					throw `Channel #${channelInfo.channel.name} could not be found or created.\n${channelMakeErr}`;
				}
			}
			dataManager.mapChannel(syntaxTree.parseData.channel.id, targetChannel.id);
		}
		return targetChannel;
	}

	/**
	 * Updates the text of a message already logged to Discord
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} channel The Slack Channel id. Can be obtained through event.channel
	 * @param {string} slackIdentifier The ID used for the Slack message associated with the Discord message
	 * @param {string} newText What to change the text to
	 */
	static async textUpdate(channel, slackIdentifier, newText) {
		let oldMessage = (await databaseManager.locateMaps(slackIdentifier))
			.filter(rowResult => rowResult["PurelyText"]);
		if(!oldMessage) console.warn(`Old Message Not Found For ${slackIdentifier}`);
		oldMessage = await channel.messages.fetch(oldMessage[0]["DiscordMessageID"]);
		let editedEmbed = new Discord.MessageEmbed(oldMessage.embeds[0]).setDescription(newText);
		await oldMessage.edit(editedEmbed);
	}

	/**
	 * Handles pinning and unpinning a logged message on the Discord side
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {boolean} [pin = false] Pins the message if true and unpins it if false
	 * @param {string} slackChannelID The Slack Channel id. Can be obtained through event.channel
	 * @param {string} slackUserID The Slack user ID of the person pinning the message on Slack
	 * @param {number} slackTs The timestamp of the pinned Slack message. Used with the channel ID to identify the message and find it
	 */
	static async setPin(pin = false, slackChannelID, slackUserID, slackTs) {
		const targetChannel = await this.locateChannel(slackChannelID);
		const user = slackUserID ? (await DiscordManager.SlackClient.users.info({ user: slackUserID })).user : undefined;
		const maps = await databaseManager.locateMaps(this.identify(slackChannelID, slackTs));
		for(const map of maps) {
			const selectedMessage = await targetChannel.messages.fetch(map["DiscordMessageID"]);
			if(pin) {
				await selectedMessage.pin({ reason: `Pinned by ${this.userIdentify(user)} at ${slackTs * 1000} Epoch Time` });
			} else {
				await selectedMessage.unpin();
			}
		}
	}

	/**
	 * Use on a Slack event to generate an id for messages that SHOULD be unique (No official documentation found)
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} channel The Slack Channel id. Can be obtained through event.channel
	 * @param {number} ts The timestamp of the Slack message
	 */
	static identify(channel, ts) {
		return `${channel}/${ts}`;
	}
}

/**
 * A module for converting Slack messages to Discord messages and sending them out to channels
 * @module discordManager
 */
module.exports = DiscordManager;