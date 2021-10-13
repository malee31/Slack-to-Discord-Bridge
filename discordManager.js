const databaseManager = require("./databaseManager.js");
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
	 * Starts up the Discord Bot responsible for logging messages, locates the logging guild, and loads the sqlite3 tables
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
		DiscordManager.client.user.setPresence({
			activities: [{
				type: "LISTENING",
				name: "Slack Messages"
			}],
			status: "online",
			afk: false
		});
		console.log(`===== Logged in as ${DiscordManager.client.user.tag} ====`);

		try {
			console.log("======= Locating Logging Server =======");
			DiscordManager.LoggingGuild = await DiscordManager.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
		} catch(locateError) {
			console.warn("⚠⚠ Failed to Locate Logging Server ⚠⚠");
			console.error(locateError);
			process.exit(1);
		}

		console.log("======= Creating SQLite3 Tables =======");
		await databaseManager.startup;
		console.log("======= SQLite3 Tables Created ========");

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
		parsedEmbed.setDescription(DiscordManager.syntaxTreeParseText(syntaxTree));
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
			if(DiscordManager.attachableFormats.includes(file.extension.toLowerCase().trim()))
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

		// Replace all mentions and channels
		for(const user of syntaxTree.parseData.users) {
			parsedText = parsedText.replace(new RegExp(user.mention, "g"), user.plainText);
		}

		// TODO: Map to actual channel on Discord and use a Discord channel mention
		for(const channel of syntaxTree.parseData.channels) {
			parsedText = parsedText.replace(new RegExp(channel.channelReference, "g"), channel.plainText);
		}

		// Additional Known Bugs:
		// * When using code blocks, the first word is invisible when sent to Discord if it is the only word on the line with the opening ``` since it is parsed as a programming language instead of text by Discord
		// console.log(parsedText);
		return parsedText;
	}

	static async handleMessages(syntaxTree) {
		const mainEmbed = DiscordManager.embedFromSyntaxTree(syntaxTree);
		const parsedMessage = {
			mainEmbed,
			// Format in {embed, files}
			additionalEmbeds: syntaxTree.attachments.files
				.map(file => DiscordManager.embedFromFile(file, mainEmbed))
		};

		syntaxTree.attachments.embeds
			.map(DiscordManager.embedFromSyntaxTree)
			.forEach(parsedMessage.additionalEmbeds.push);

		const targetData = await DiscordManager.locateChannel(syntaxTree);

		if(parsedMessage.additionalEmbeds.length !== 0) mainEmbed.embeds[0].setFooter(`${mainEmbed.embeds[0].footer ? `${mainEmbed.embeds[0].footer}\n` : ""}↓ Message Includes ${parsedMessage.additionalEmbeds.length} Additional Attachment${parsedMessage.additionalEmbeds.length === 1 ? "" : "s"} Below ↓`);
		const sentMessage = await targetData.target.send(mainEmbed);
		const messageIDs = [];
		await databaseManager.messageMap({
			SlackMessageID: syntaxTree.timestamp,
			DiscordMessageID: sentMessage.id,
			SlackThreadID: syntaxTree.parseData.thread.id,
			DiscordThreadID: targetData.thread?.id,
			textOnly: true
		}).then(() => {
			console.log(`Mapped Slack ${syntaxTree.timestamp} to Discord ${sentMessage.id}`);
		}).catch(err => {
			console.warn(`MAP ERROR:\n${err}`)
		});

		for(const additionalData of parsedMessage.additionalEmbeds)
			messageIDs.push(await targetData.target.send(additionalData)
				.then(message => message.id)
			);

		await Promise.all(messageIDs.map(id =>
			databaseManager.messageMap({
				SlackMessageID: syntaxTree.timestamp.toString(),
				DiscordMessageID: id,
				SlackThreadID: syntaxTree.parseData.thread.id,
				DiscordThreadID: targetData.thread?.id
			}).then(() => {
				console.log(`Mapped Slack ${syntaxTree.timestamp} to Discord ${id}`);
			}).catch(err => {
				console.warn(`MAP ERROR:\n${err}`)
			}))
		);

		// Clean-up downloaded files after sending
		await Promise.all(
			syntaxTree.attachments.files
				.filter(file => file.size < 8)
				.map(file => fileManager.fileDelete(file.path))
		);
	}

	static async handleChanges(syntaxTree) {
		const mainEmbed = DiscordManager.embedFromSyntaxTree(syntaxTree);
		const targetChannel = await DiscordManager.locateChannel(syntaxTree);
		const originalMessageID = (await databaseManager.locateMessageMaps(syntaxTree.timestamp.toString())).find(map => map.PurelyText);
		if(!originalMessageID) return console.warn(`Old Message Not Found For ${syntaxTree.timestamp}`);
		const originalMessage = await targetChannel.messages.fetch(originalMessageID.DiscordMessageID);
		await originalMessage.edit(mainEmbed);
	}

	static async handleDeletes(syntaxTree) {
		const targetChannel = await DiscordManager.locateChannel(syntaxTree);
		// TODO: Delete only what is necessary. Currently deletes all parts of a message even if only a portion is deleted from Slack
		//  (Example: Deleting 1/3 files on Slack deletes all 3 and the text on Discord)
		await Promise.all((await databaseManager.locateMessageMaps(syntaxTree.additional.deletedTimestamp))
			.map(async map => {
				const message = await targetChannel.messages.fetch(map["DiscordMessageID"]);
				await message.delete();
			}));
	}

	static async handleChannelUpdates(syntaxTree) {
		const targetChannel = await DiscordManager.locateChannel(syntaxTree);
		const channelData = syntaxTree.parseData.channel;
		const discordTopic = `${channelData.topic} | ${channelData.purpose || "Archive Channel"}`;
		if(targetChannel.name !== channelData.name) await targetChannel.setName(channelData.name, "Channel name changed from Slack");
		if(targetChannel.topic !== discordTopic) await targetChannel.setTopic(discordTopic, "Channel Topic changed from Slack");
	}

	/**
	 * Locates a channel given a Slack Channel ID. Will grab associated channel from the serverMap.json or search by name. If it does not exist, the bot will create a channel with a matching name and serverMap it
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 */
	static async locateChannel(syntaxTree) {
		// TODO: Patch function
		const channelData = syntaxTree.parseData.channel;
		const targetData = {
			id: undefined,
			channel: undefined,
			thread: undefined,
			target: undefined
		};

		const targetChannelID = await databaseManager.locateChannelMap(channelData.id);
		if(targetChannelID) {
			targetData.channel = await DiscordManager.LoggingGuild.channels.fetch(targetChannelID);
		} else {
			// Quirk: If two channels on Discord have a matching name, only the first one found will be used
			const allChannels = (await DiscordManager.LoggingGuild.channels.fetch());
			targetData.channel = allChannels
				.filter(channel => channel.type === "GUILD_TEXT")
				.find(channel => channel.name === channelData.name);

			if(!(targetData.channel instanceof Discord.TextChannel)) {
				try {
					targetData.channel = await DiscordManager.LoggingGuild.channels.create(channelData.name, { reason: `#${channelData.name} created for new Slack Messages` });
				} catch(channelMakeErr) {
					throw `Channel #${channelData.name} could not be found or created.\n${channelMakeErr}`;
				}
			}

			await databaseManager.tableMap(databaseManager.Tables.CHANNEL_MAP, channelData.id, targetData.channel.id);
		}

		if(syntaxTree.parseData.thread.id) targetData.thread = await this.locateThread(syntaxTree, targetData.channel);
		targetData.id = targetData.channel.id;
		targetData.target = targetData.thread || targetData.channel;

		return targetData;
	}

	static async locateThread(syntaxTree, channel) {
		// Note: Does NOT look things up by name unlike locateChannel.
		// TODO: Test function
		const storedThreadID = await databaseManager.locateThreadMap(syntaxTree.parseData.thread.id);
		// debugger;
		let targetThread;
		if(storedThreadID) {
			targetThread = await channel.threads.fetch(storedThreadID);
		} else {
			const threadID = syntaxTree.parseData.thread.id;
			const boundMessageIDs = await databaseManager.locateMessageMaps(threadID);
			const originalMessageID = boundMessageIDs
				.find(messageMap => messageMap.PurelyText)
				.DiscordMessageID;

			const originalMessage = await channel.messages.fetch(originalMessageID);
			const originalContent = originalMessage.embeds[0].description || "No Text Content";

			debugger;
			if(originalMessage.hasThread) {
				targetThread = originalMessage.thread;
			} else {
				targetThread = await originalMessage.startThread({
					// 1-Day
					name: originalContent.length > 50 ? `${originalContent.slice(0, 49)}…` : originalContent,
					autoArchiveDuration: 1440,
					reason: "Mirroring thread started on Slack"
				});
			}

			await databaseManager.tableMap(databaseManager.Tables.THREAD_MAP, threadID, targetThread.id);
		}

		return targetThread;
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
		let oldMessage = (await databaseManager.locateMessageMaps(slackIdentifier))
			.find(rowResult => rowResult["PurelyText"]);
		if(!oldMessage) console.warn(`Old Message Not Found For ${slackIdentifier}`);
		oldMessage = await channel.messages.fetch(oldMessage["DiscordMessageID"]);
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
		const targetChannel = await DiscordManager.locateChannel(slackChannelID);
		const user = slackUserID ? (await DiscordManager.SlackClient.users.info({ user: slackUserID })).user : undefined;
		const maps = await databaseManager.locateMessageMaps(DiscordManager.identify(slackChannelID, slackTs));
		for(const map of maps) {
			const selectedMessage = await targetChannel.messages.fetch(map["DiscordMessageID"]);
			if(pin) {
				await selectedMessage.pin({ reason: `Pinned by ${DiscordManager.userIdentify(user)} at ${slackTs * 1000} Epoch Time` });
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