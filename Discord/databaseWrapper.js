// Wraps around database functions, providing checks to some functions and automatically looking up the object in question for others
const databaseManager = require("../databaseManager.js");
let guild;

const realExports = {
	// In case the code attempts to start up a second time. A no-op that returns module exports
	startup: () => realExports,
	messageMap,
	locateMessageMaps,
	initiated: true
};
module.exports = { startup };

async function startup(loggingGuild) {
	if(!guild) {
		guild = loggingGuild;
	}

	await databaseManager.startup;

	// Allow access to the actual module exports
	Object.assign(module.exports, realExports);

	return module.exports;
}

async function messageMap(passthroughObj) {
	try {
		await databaseManager.messageMap(passthroughObj);
		console.log(`Mapped Slack ${passthroughObj.SlackMessageID} to Discord ${passthroughObj.DiscordMessageID}`);
	} catch(err) {
		console.warn(`MAP ERROR:\n${err}`)
	}
}

// Will return an array of all maps. Selecting textOnly will return one or no results only
async function locateMessageMaps(SlackMessageID, textOnly = false, messageLookup = true) {
	const maps = (await databaseManager.locateMessageMaps(SlackMessageID));

	if(maps.length === 0) {
		console.warn(`Message Map(s) Not Found For [${SlackMessageID}]`);
	}

	const results = maps
		.filter(map => !textOnly || map["PurelyText"])
		.map(map => !messageLookup ? map : messageMapToMessage(map).catch(err => {
			console.warn(`Unable To Find Discord Message For ${map.DiscordMessageID} (${map.SlackMessageID})`)
		}));

	if(results.length === 0) {
		console.warn(`Message Map(s) Not Found For [${SlackMessageID}] [TEXT ONLY]`);
	}

	return await Promise.all(results);
}

async function messageMapToMessage(map) {
	if(!map) {
		return;
	}

	let channel = await guild.channels.fetch(map.DiscordChannelID);
	if(map.DiscordThreadID !== "Main") {
		channel = await channel.threads.fetch(map.DiscordThreadID);
	}
	return channel.messages.fetch(map.DiscordMessageID);
}