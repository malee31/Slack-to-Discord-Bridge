/**
 * Wrapper for database functions, provides safety checks to some functions and automatically looks up the object linked to an ID for others
 * @module databaseWrapper
 */
const databaseManager = require("../databaseManager.js");
let guild;

/**
 * The actual exports of the file. Exports are assigned to module.exports after startup is completed
 * @type {any}
 */
const realExports = {
	// In case the code attempts to start up a second time. A no-op that returns module exports
	startup: () => realExports,
	messageMap,
	locateMessageMaps,
	initiated: true
};
module.exports = { startup };

/**
 * A function that resolves once the database and DiscordManager have successfully started up. Duplicate calls will result in no-ops<br>
 * Must be called before using any other function exported by this file (Other functions are inaccessible until this resolves)
 * @async
 * @param {Discord.Guild} loggingGuild Discord server/guild object
 * @return {Promise} Resolves once startup is complete and functions become accessible
 */
async function startup(loggingGuild) {
	if(!guild) {
		guild = loggingGuild;
	}

	await databaseManager.startup;

	// Allow access to the actual module exports
	Object.assign(module.exports, realExports);

	return module.exports;
}

/**
 * Wrapper for databaseManager.messageMap. Adds error handling to messageMap to prevent the program from crashing after being unable to add an entry
 * @param {Object} passthroughObj Object to pass to databaseManager.messageMap
 * @return {Promise<void>}
 */
async function messageMap(passthroughObj) {
	try {
		await databaseManager.messageMap(passthroughObj);
		console.log(`Mapped Slack ${passthroughObj.SlackMessageID} to Discord ${passthroughObj.DiscordMessageID}`);
	} catch(err) {
		console.warn(`MAP ERROR:\n${err}`)
	}
}

/**
 * Will return an array of all maps. Selecting textOnly will return one or no results only
 * @async
 * @param {string} SlackMessageID The id of a Slack message to look up
 * @param {boolean} [textOnly = false] Whether to filter out message maps that don't contain the main text content
 * @param {boolean} [messageLookup = true] Whether to automatically look up the message map on Discord
 * @return {Object[]|Discord.Message[]} Array of maps or Discord message objects. May be empty
 */
async function locateMessageMaps(SlackMessageID, textOnly = false, messageLookup = true) {
	const maps = (await databaseManager.locateMessageMaps(SlackMessageID));

	if(maps.length === 0) {
		console.warn(`Message Map(s) Not Found For [${SlackMessageID}]`);
	}

	// TODO: Improve error handling
	const results = maps
		.filter(map => !textOnly || map["PurelyText"])
		.map(map => !messageLookup ? map : messageMapToMessage(map).catch(err => {
			console.warn(`Unable To Find Discord Message For ${map.DiscordMessageID} (${map.SlackMessageID})`);
			return false;
		}));

	if(results.length === 0) {
		console.warn(`Message Map(s) Not Found For [${SlackMessageID}] [TEXT ONLY]`);
	}

	return (await Promise.all(results)).filter(result => result !== false);
}

/**
 * Converts a Message Map into a Discord Message object
 * @async
 * @param {Object} map Message map to look up
 * @return {Message|undefined} Resolves to the located message or nothing if not found
 */
async function messageMapToMessage(map) {
	if(!map) {
		return;
	}

	let channel = await guild.channels.fetch(map.DiscordChannelID);
	if(map.DiscordThreadID !== "Main") {
		channel = await channel.threads.fetch(map.DiscordThreadID);
		if(channel.archived) {
			await channel.setArchived(false, "Unarchived Thread for Incoming Slack Events");
		}
	}
	return channel.messages.fetch(map.DiscordMessageID);
}