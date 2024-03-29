const databaseManager = require("../databaseManager.js");
let databaseWrapper = require("./databaseWrapper.js");
const fileManager = require("../fileManager.js");
const Discord = require("discord.js");

/**
 * Slack's HTTP client for making requests to Slack’s Web API
 * @external WebClient
 * @see https://slack.dev/node-slack-sdk/web-api
 */

/**
 * Handles all things related to the Discord end of things. Most functions take in a specific subtype of SyntaxTree<br>
 * Meant to be a static class (Do not initialize members of this class)
 */
class DiscordManager {
	/**
	 * Array containing a list of formats that Discord embeds consider attachable.<br>
	 * Files with these extensions are sent in embeds instead of by themselves.<br>
	 * Audio extensions removed from attachable formats because they automatically embed themselves (Wow flac files are huge!)<br>
	 * Video formats removed from attachable formats because they automatically embed themselves then fail to load (Still available via "Open Original" download link though)<br>
	 * Type gif was removed because they don't work in embeds for some reason. Also, gifv technically is not real.
	 * @type {string[]}
	 */
	static attachableFormats = ["png", "jpg", "jpeg"];
	/**
	 * The Discord bot client being used by the manager. Remember to call start() before using
	 * @type {Discord.Client}
	 */
	static client = new Discord.Client({ intents: require("./Intents.js") });
	/**
	 * Discord Server/Guild to log messages into
	 * @type {Discord.Guild}
	 */
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
		databaseWrapper = await databaseWrapper.startup(DiscordManager.LoggingGuild);
		console.log("======= SQLite3 Tables Created ========");

		console.log("========== Discord Bot Ready ==========");
	}

	/**
	 * Does not handle attachments. Only top level data (depth of 1) for a syntax tree AKA the main embed
	 * @param {SyntaxTreeBase} syntaxTree A SyntaxTreeBase or anything extending it that can be used to create a blank embed (Sets colors, author, timestamp, and text)
	 */
	static embedFromSyntaxTree(syntaxTree) {
		const parsedEmbed = new Discord.MessageEmbed();

		parsedEmbed.setColor(syntaxTree.color);
		parsedEmbed.setAuthor(syntaxTree.name, syntaxTree.profilePic);
		parsedEmbed.setDescription(DiscordManager.syntaxTreeParseText(syntaxTree));
		parsedEmbed.setTimestamp(syntaxTree.timestamp * 1000);

		return { embeds: [parsedEmbed] };
	}

	/**
	 * Converts a file object from a Syntax Tree into an embed
	 * @param {FileData} file Data about the file to convert into an embed
	 * @param {Discord.MessageEmbed} templateEmbed Blank embed that the file will be added onto. Set colors, timestamps, and more before passing it into this function
	 * @return {Object} Final Discord message payload. Contains two arrays: embeds which should be sent first and files which should be sent after
	 */
	static embedFromFile(file, templateEmbed) {
		if(!templateEmbed instanceof Discord.MessageEmbed) {
			throw new TypeError("Template Embed Required");
		}

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
			if(process.env.SERVER_URL) {
				serverURLText += `\n(${process.env.SERVER_URL}/${encodeURIComponent(file.storedAs)})`;
			}
			result.embeds.push(fileEmbed.setDescription(`[File Too Large to Send](${file.original.url_private})${serverURLText}`));
		}

		return result;
	}

	/**
	 * Converts text from Slack Markdown to Discord Markdown
	 * @param {SyntaxTreeBase} syntaxTree Syntax tree to fetch message from
	 * @return {string} Parsed message. Returns a default string if there is no message
	 */
	static syntaxTreeParseText(syntaxTree) {
		if(syntaxTree.unparsedText.length === 0) {
			return "[No Message Content]";
		}
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

	/**
	 * Handles sending messages to Discord
	 * @param {MessageSyntaxTree} syntaxTree Syntax tree to parse and send
	 * @return {Promise} Resolves when messages have been successfully sent
	 */
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

		if(parsedMessage.additionalEmbeds.length !== 0) {
			mainEmbed.embeds[0].setFooter(`${mainEmbed.embeds[0].footer ? `${mainEmbed.embeds[0].footer}\n` : ""}↓ Message Includes ${parsedMessage.additionalEmbeds.length} Additional Attachment${parsedMessage.additionalEmbeds.length === 1 ? "" : "s"} Below ↓`);
		}
		const sentMessage = await targetData.target.send(mainEmbed);
		const messageIDs = [];
		await databaseWrapper.messageMap({
			SlackMessageID: syntaxTree.timestamp,
			DiscordMessageID: sentMessage.id,
			SlackThreadID: syntaxTree.parseData.thread.id,
			DiscordThreadID: targetData.thread?.id,
			SlackChannelID: syntaxTree.parseData.channel.id,
			DiscordChannelID: targetData.channel.id,
			textOnly: true
		});

		for(const additionalData of parsedMessage.additionalEmbeds)
			messageIDs.push(await targetData.target.send(additionalData)
				.then(message => message.id)
			);

		await Promise.all(messageIDs.map(id =>
			databaseWrapper.messageMap({
				SlackMessageID: syntaxTree.timestamp,
				DiscordMessageID: id,
				SlackThreadID: syntaxTree.parseData.thread.id,
				DiscordThreadID: targetData.thread?.id,
				SlackChannelID: syntaxTree.parseData.channel.id,
				DiscordChannelID: targetData.channel.id,
			})
		));

		// Clean-up downloaded files after sending
		await Promise.all(
			syntaxTree.attachments.files
				.filter(file => file.size < 8)
				.map(file => fileManager.fileDelete(file.path))
		);
	}

	/**
	 * Handles reflecting edits/changes on Discord
	 * @param {ChangeSyntaxTree} syntaxTree Syntax tree with edits to parse and send. Mostly identical to MessageSyntaxTree
	 * @return {Promise} Resolves when messages have been successfully sent/edited
	 */
	static async handleChanges(syntaxTree) {
		const timestamp = syntaxTree.timestamp.toString();
		const mainEmbed = DiscordManager.embedFromSyntaxTree(syntaxTree);
		const originalMessageMaps = await databaseWrapper.locateMessageMaps(timestamp, true);

		if(originalMessageMaps.length === 0) {
			console.warn(`Unable to edit message: Original Message Not Found For ${timestamp}`);
		} else if(originalMessageMaps.length >= 1) {
			console.warn(`Odd Behavior Warning: Multiple Messages Will Be Overwritten For ${timestamp}`);
		}

		await Promise.all(originalMessageMaps.map(message => message.edit(mainEmbed)));
	}

	/**
	 * Handles reflecting message deletions on Discord. Safely ignores messages that cannot be found
	 * @param {DeleteSyntaxTree} syntaxTree Syntax tree with information about what messages to delete
	 * @return {Promise} Resolves when messages have been successfully deleted
	 */
	static async handleDeletes(syntaxTree) {
		// TODO: Delete only what is necessary. Currently deletes all parts of a message even if only a portion is deleted from Slack
		//  (Example: Deleting 1 of 3 files on Slack deletes all 3 + the message on Discord)
		const messages = await databaseWrapper.locateMessageMaps(syntaxTree.timestamp);
		console.log(`Deleting ${messages.length} Messages`);
		await Promise.all(messages
			.map(message => message.delete()
				.catch(err => {
					console.warn(`Unable to Delete Message ${message.id} (${syntaxTree.timestamp}): [${err.name}] ${err.message}`);
				}))
		);
	}

	/**
	 * Handles reflecting channel metadata updates on Discord
	 * @param {ChannelSyntaxTree} syntaxTree Syntax tree with channel metadata. It's literally the same as the base syntax tree class
	 * @return {Promise} Resolves when channel data has been updated
	 */
	static async handleChannelUpdates(syntaxTree) {
		const targetChannel = await DiscordManager.locateChannel(syntaxTree);
		const channelData = syntaxTree.parseData.channel;
		const discordTopic = `${channelData.topic} | ${channelData.purpose || "Archive Channel"}`;
		if(targetChannel.name !== channelData.name) {
			await targetChannel.setName(channelData.name, "Channel name changed from Slack");
		}
		if(targetChannel.topic !== discordTopic) {
			await targetChannel.setTopic(discordTopic, "Channel Topic changed from Slack");
		}
	}

	/**
	 * Locates a channel given a Slack Channel ID. Will grab associated channel from the serverMap.json or search by name. If it does not exist, the bot will create a channel with a matching name and serverMap it
	 * @async
	 * @memberOf module:discordManager.DiscordManager
	 * @param {SyntaxTreeBase} A syntax tree with data on what channel to look up
	 * @return {Promise<{channel: Discord.TextChannel, id: string, thread: undefined | Discord.ThreadChannel, target: Discord.TextChannel | Discord.ThreadChannel}>} Resolves to an object containing what channel can/should be sent to
	 */
	static async locateChannel(syntaxTree) {
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

		if(syntaxTree.parseData.thread.id) {
			targetData.thread = await this.locateThread(syntaxTree, targetData.channel);
		}
		targetData.id = targetData.channel.id;
		targetData.target = targetData.thread || targetData.channel;

		return targetData;
	}

	/**
	 * Creates and sends out a fake message and links it to a Slack Message. Used when creating threads without an existing starting point on the Discord end
	 * @async
	 * @param {string} threadID ID for the thread that the fake message is for
	 * @param {MessageSyntaxTree} syntaxTreeBase Syntax tree for the next message in the thread
	 * @param {MessageSyntaxTree} syntaxTreeMessageSkeleton An empty syntax tree to use for the fake message
	 * @return {string} Returns the DiscordMessageID of the fake message (Now the starting point of a thread)
	 */
	static async fakeMessage(threadID, syntaxTreeBase, syntaxTreeMessageSkeleton) {
		// Share properties via shallow copy
		Object.assign(syntaxTreeMessageSkeleton.parseData.channel, syntaxTreeBase.parseData.channel);

		console.log(`Thread ${threadID} is missing. Creating fake main message...`);
		syntaxTreeMessageSkeleton.name = "Unknown Thread Handler";
		syntaxTreeMessageSkeleton.unparsedText = "[Thread Not Found: Some Messages May Be Missing]";
		syntaxTreeMessageSkeleton.color = "#DD2020";
		syntaxTreeMessageSkeleton.timestamp = threadID;
		await DiscordManager.handleMessages(syntaxTreeMessageSkeleton);
		console.log(`Missing Main Message Created For Thread ${threadID}. Proceeding...`);
		return (await databaseManager.locateMessageMaps(threadID))[0].DiscordMessageID;
	}

	/**
	 * Finds a specific thread channel given information about it and the main channel it should be in. Creates one if it does not exist
	 * @param {SyntaxTreeBase} syntaxTree Syntax tree containing the thread id to look up
	 * @param {Discord.TextChannel} channel Discord channel to find or make thread channel in
	 * @return {Discord.ThreadChannel} Returns the located thread channel
	 */
	static async locateThread(syntaxTree, channel) {
		// Note: Does NOT look things up by name unlike locateChannel.
		const storedThreadID = await databaseManager.locateThreadMap(syntaxTree.parseData.thread.id);
		let targetThread;
		if(storedThreadID) {
			targetThread = await channel.threads.fetch(storedThreadID);
		} else {
			const threadID = syntaxTree.parseData.thread.id;
			const boundMessageIDs = await databaseManager.locateMessageMaps(threadID);
			const originalMessageID = boundMessageIDs
				.find(messageMap => messageMap.PurelyText)
				?.DiscordMessageID || await DiscordManager.fakeMessage(threadID, syntaxTree, syntaxTree.parseData.thread.skeleton);

			const originalMessage = await channel.messages.fetch(originalMessageID);
			const originalContent = originalMessage.embeds[0]?.description || "No Text Content";

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