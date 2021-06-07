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
	/**
	 * A class that manages parsing from Slack to Discord formats and sending out to channels
	 * @constructor
	 * @memberOf module:discordManager
	 * @param {WebClient} SlackWebAPIClient The Slack web client that allows interaction with their api
	 */
	constructor(SlackWebAPIClient) {
		this.slackClient = SlackWebAPIClient;
		this.client = new Discord.Client();
		this.client.once("disconnect", () => {
			console.log("======= Disconnecting. Goodbye! =======");
			process.exit(1);
		});
		this.attachableFormats = ["png", "jpg", "jpeg"];
	}

	/**
	 * Starts up the Discord Bot responsible for logging messages, locates the logging guild, and loads the serverMap.json to (dataManager.js).load()
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 */
	async start() {
		await this.client.login(process.env.DISCORD_TOKEN);
		console.log(`===== Logged in as ${this.client.user.tag} ====`);
		try {
			await this.client.user.setPresence({
				activity: {
					type: "LISTENING",
					name: "Slack Messages"
				},
				status: "online",
				afk: false
			});
			console.log("====== Successfully Set Presence ======");
		} catch(err) {
			console.warn("⚠⚠⚠⚠⚠ Failed to Set Presence ⚠⚠⚠⚠⚠");
			console.error(err);
		}

		try {
			console.log("======= Locating Logging Server =======");
			this.loggingGuild = await this.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
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
	 * Locates a channel given a Slack Channel ID. Will grab associated channel from the serverMap.json or search by name. If it does not exist, the bot will create a channel with a matching name and serverMap it
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} slackChannelID The Slack Channel id. Can be obtained through event.channel
	 * @return {Promise<GuildChannel>} Returns the located Discord channel
	 */
	async locateChannel(slackChannelID) {
		let targetChannel = this.loggingGuild.channels.cache.get(dataManager.getChannel(slackChannelID));
		if(!targetChannel) {
			let channelInfo;
			try {
				channelInfo = await this.slackClient.conversations.info({ channel: slackChannelID });
			} catch(channelInfoErr) {
				throw `Slack conversations.info error:\n${channelInfoErr}`;
			}
			if(!channelInfo.channel) {
				console.warn("No channelInfo.channel found: ", channelInfo);
				channelInfo.channel = { name: "unknown_channel_name" };
			}
			if(!channelInfo.channel.name) {
				console.warn("No channelInfo.channel.name found: ", channelInfo.channel);
				channelInfo.channel.name = "unknown_channel_name";
			}
			// Quirk: First occurrence of channel with the same name on Discord is used. The second occurrence is ignored
			targetChannel = await this.loggingGuild.channels.cache.find(channel => channel.type === "text" && channel.name === channelInfo.channel.name);
			if(!targetChannel) {
				try {
					targetChannel = await this.loggingGuild.channels.create(channelInfo.channel.name, { reason: `#${channelInfo.channel.name} created for new Slack Messages` });
				} catch(channelMakeErr) {
					// Use the line below instead of throwing if there is a default channel listed in serverMap.json you would like to send to instead of throwing
					// return this.loggingGuild.channels.cache.get(dataManager.getChannel(event.channel, true));
					throw `Channel #${channelInfo.channel.name} could not be found or created.\n${channelMakeErr}`;
				}
			}
			dataManager.mapChannel(slackChannelID, targetChannel.id);
		}
		return targetChannel;
	}

	// Removed from attachable formats because audio formats auto-embed themselves (Wow flac files are huge!):
	// Removed from attachable formats because video formats auto-embed themselves then fail to load (Still available via "Open Original" download link):
	// Do not work with embeds (Also, apparently "gifv" is not real): ["gif"]
	/**
	 * Parses the array of Slack files attached to a message by downloading them and adding ones that are under 8MB as embeds and those over 8MB as links
	 * Notes: Discord auto-embeds ["mp3", "ogg", "wav", "flac"] formats and ["gif"] does not like to be embedded for some odd reason.
	 * Video formats such as ["mov", "webm", "mp4"] will auto-embed but sometimes fail to load but the original can still be downloaded from the "See Original" link
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {MessageEmbed[]} embedArr Array to add file embeds onto. Assumed to have at least 1 embed inside it before the function is called
	 * @param {Object[]} slackFiles Array of Objects from a Slack message event that includes their download URLs. Passed to fileManager.fileDownload. Can be obtained through event.files
	 * @returns {Promise<Object[]>} Array of objects containing details on where the file is, what is is called, the original Slack file object, and more. Originates from resolving fileManager.fileDownload on all files
	 */
	async attachmentEmbeds(embedArr, slackFiles) {
		let downloads = [];
		// console.log("ATTEMPTING FILE DOWNLOAD");
		for(const fileObj of slackFiles) {
			downloads.push(fileManager.fileDownload(fileObj));
		}

		downloads = await Promise.all(downloads);

		let sliceNum = 1;

		if(this.attachableFormats.includes(downloads[0].extension.toLowerCase().trim()) && downloads[0].size < 8) {
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
				if(file.size < 8) {
					if(this.attachableFormats.includes(file.extension.toLowerCase().trim())) {
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
					let serverURLText = `[Copy Saved on Server as: /${file.storedAs}]`;
					if(process.env.SERVER_URL) {
						serverURLText += `(${process.env.SERVER_URL}/${encodeURIComponent(file.storedAs)})`;
					}
					newFileEmbed.setDescription(`[File Too Large to Send](${file.original.url_private})\n${serverURLText}`);
				}
				embedArr.push(newFileEmbed);
			}));
		}

		return downloads;
	}

	/**
	 * Updates the text of a message already logged to Discord
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} channel The Slack Channel id. Can be obtained through event.channel
	 * @param {string} slackIdentifier The ID used for the Slack message associated with the Discord message
	 * @param {string} newText What to change the text to
	 */
	async textUpdate(channel, slackIdentifier, newText) {
		let oldMessage = (await databaseManager.locateMaps(slackIdentifier))
			.filter(async rowResult => rowResult["PurelyText"]);
		if(!oldMessage) console.warn(`Old Message Not Found For ${slackIdentifier}`);
		oldMessage = await channel.messages.fetch(oldMessage[0]["DiscordMessageID"]);
		let editedEmbed = new Discord.MessageEmbed(oldMessage.embeds[0]).setDescription(newText);
		await oldMessage.edit(editedEmbed);
	}

	/**
	 * Deletes messages associated with a given Slack message ID
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {TextChannel} channel The Discord text channel where the message-to-be-deleted is
	 * @param {string} slackIdentifier The ID used for the Slack message associated with the Discord message
	 */
	async delete(channel, slackIdentifier) {
		await Promise.all((await databaseManager.locateMaps(slackIdentifier)).map(async DMID => {
			let message = await channel.messages.fetch(DMID["DiscordMessageID"]);
			await message.delete();
		}));
	}

	/**
	 * Handles sending out all the embeds into a Discord channel and storing their IDs in the SQLite database
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {TextChannel} discordChannel The Discord text channel where the messages/embeds will be logged to
	 * @param {MessageEmbed[]} discordEmbeds Array of Discord embeds to send out
	 * @param {string} [mapTo] The ID used for the Slack message associated with the Discord messages. Use if the message ids should be kept in the database for future edits and deletions
	 * @param {boolean} canHaveText Whether or not to mark the first embed as the embed to edit if text changes. Assumes first embed in array is the one with text from the Slack message
	 * @returns {Promise<Message[]>} Array of the Discord messages sent to the channel and their details. Originates from TextChannel.send
	 */
	async embedSender(discordChannel, discordEmbeds = [], mapTo, canHaveText = true) {
		if(discordEmbeds.length > 1) discordEmbeds[0].setFooter(`${discordEmbeds[0].footer || ""}\n↓ Message Includes ${discordEmbeds.length - 1} Additional Attachment${discordEmbeds.length === 2 ? "" : "s"} Below ↓`);
		for(let embedNum = 0; embedNum < discordEmbeds.length; embedNum++) {
			discordEmbeds[embedNum] = await discordChannel.send(discordEmbeds[embedNum]);
			if(mapTo) {
				databaseManager.messageMap(mapTo, discordEmbeds[embedNum].id, canHaveText, err => {
					if(err) console.log(`MAP ERROR:\n${err}`);
					// console.log(`Mapped Slack ${mapTo} to Discord ${sentMessage.id}`);
				});
				canHaveText = false;
			}
		}
		return discordEmbeds;
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
	async setPin(pin = false, slackChannelID, slackUserID, slackTs) {
		const targetChannel = await this.locateChannel(slackChannelID);
		const user = slackUserID ? (await this.slackClient.users.info({ user: slackUserID })).user : undefined;
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
	identify(channel, ts) {
		return `${channel}/${ts}`;
	}

	/**
	 * Creates a more readable name for each user than their user ID
	 * @memberOf module:discordManager.DiscordManager
	 * @param {Object} user User object obtained through the Slack users.info endpoint
	 * @returns {string} String to use as their username when logging messages
	 */
	userIdentify(user = {}) {
		if(!user.real_name || !user.id) return "Unknown Pupper";
		return `${user.real_name}@${user.id}`;
	}

	/**
	 * Converts Slack markdown to Discord markdown. Has some acceptable edge cases
	 * @memberOf module:discordManager.DiscordManager
	 * @param {string} text Slack text to convert
	 * @returns {Promise<string>} Resulting text with Discord markdown
	 */
	async slackTextParse(text) {
		// Regex differs slightly from official regex defs_user_id in https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json
		// Known Bugs:
		// * Slow. Each mention slows down parsing significantly
		let mentions = text.match(/(?<=<@)[UW][A-Z0-9]{8}([A-Z0-9]{2})?(?=>)/g);
		if(mentions) {
			let identify = mentions.filter((id, index) => mentions.indexOf(id) === index).map(id => {
				return this.slackClient.users.info({ user: id });
			});
			(await Promise.all(identify)).forEach(userInfo => {
				text = text.replace(new RegExp(`<@${userInfo.user.id}>`, 'g'), `[${this.userIdentify(userInfo.user)}]`);
			});
		}

		// URL Slack to Discord Markdown Translation
		// Known Bugs:
		// * Including the character '>' in any part of the link's text will make the translation cut off early
		// * Certain non-urls will not parse correctly for some odd reason. For example, Slack will try to auto-encode text into a URL if it is entered as one and that won't sit well with Discord
		let urls = text.match(/(?<=<)https?:\/\/[\w@:%.\/+~#=]+(|.+?)?(?=>)/g);
		if(urls) {
			urls.map(link => {
				let split = link.split("|");
				text = text.replace(`<${link}>`, `[${split[1] && split[1].trim().length > 0 ? split[1].trim() : split[0]}](${split[0]})`);
			});
		}

		// Simple Slack to Discord Markdown Translation
		// Known Bugs:
		// * Using Ctrl + Z on Slack to undo any markdown results in that undo being ignored on Discord. Escaped markdown is parsed as if it was never escaped
		// * Formatting markdown using the format buttons instead of actual markdown means that results may not reflect what is seen on Slack
		// Strikethrough Translation
		text = text.replace(/~~/g, "\\~\\~").replace(/(?<=^|\s)(~(?=[^\s])[^~]+(?<=[^\s])~)(?=$|\s)/g, "~$1~");
		// Italic Translation (Untested)
		text = text.replace(/(?<=^|\s)_((?=[^\s])[^_]+(?<=[^\s]))_(?=$|\s)/g, "*$1*");
		// Bold Translation (Untested)
		text = text.replace(/(?<=^|\s)(\*(?=[^\s])[^_]+(?<=[^\s])\*)(?=$|\s)/g, "*$1*");

		// Unescaping HTML Escapes created by Slack's API
		// Known Bugs:
		// * Literally typing any of the following HTML escape codes normally will result in them being converted over to their unescaped form on Discord
		// - Typing &gt; on Slack translates to > on Discord
		// - Typing &lt; on Slack translates to < on Discord
		// - Typing &amp; on Slack translates to & on Discord
		text = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

		// Additional Known Bugs:
		// * When using code blocks, the first word is invisible when sent to Discord if it is the only word on the line with the opening ``` since it is parsed as a programming language instead of text by Discord
		// console.log(text);
		return text;
	}
}

/**
 * A module for converting Slack messages to Discord messages and sending them out to channels
 * @module discordManager
 */
module.exports = DiscordManager;