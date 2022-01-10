// Wraps around database functions, providing checks to some functions and automatically looking up the object in question for others
const databaseManager = require("../databaseManager.js");
let guild;

const realExports = {
	// In case the code attempts to start up a second time. A no-op that returns module exports
	startup: () => realExports,
	messageMap,
	locateMessageMaps
};
module.exports = { startup };

async function startup(loggingGuild) {
	if(!guild) {
		guild = loggingGuild;
	}

	// Allow access to the actual module exports
	module.exports = realExports;

	await databaseManager.startup;
	return realExports;
}

async function messageMap(passthroughObj) {
	try {
		await databaseManager.messageMap(passthroughObj);
		console.log(`Mapped Slack ${passthroughObj.SlackMessageID} to Discord ${passthroughObj.DiscordMessageID}`);
	} catch(err) {
		console.warn(`MAP ERROR:\n${err}`)
	}
}

// Will return an array of all maps unless the textOnly option is selected (In which case it will only return the one without an array)
async function locateMessageMaps(SlackMessageID, { textOnly = false, messageLookup = true }) {
	const maps = await databaseManager.locateMessageMaps(SlackMessageID);
	if(!maps) {
		console.warn(`Message Map(s) Not Found For [${SlackMessageID}]`);
		return;
	}

	let result = maps;
	if(textOnly) {
		const result = maps.find(map => map.PurelyText);
		if(!result) {
			console.warn(`Message Map(s) Not Found For [${SlackMessageID}] [TEXT ONLY]`);
			return;
		}
	}

	if(messageLookup) {
		if(textOnly) {
			result = messageMapToMessage(result);
		} else {
			result = Promise.all(result.map(messageMapToMessage));
		}
	}

	return result;
}

async function messageMapToMessage(map) {
	if(!map) {
		return;
	}

	// TODO: Safety checks
	let channel = await guild.channels.fetch(map.DiscordChannelID);
	if(map.DiscordThreadID === "Main") {
		channel = await channel.threads.fetch(map.DiscordThreadID);
	}

	return channel.messages.fetch(map.DiscordMessageID);
}