const path = require("path");
const fs = require("fs");

const serverMapPath = path.resolve(__dirname, "serverMap.json");
// Default serverMap template
const data = {
	channelMapComment: "Channel map is in Key(Slack Channel): Value(Discord Channel) Pairs. Set a default channel to send to if you are using that feature",
	channelMap: {
		default: "none"
	}
};

/**
 * A module for managing the small JSON file used for mapping a Slack Channel ID to an associated Discord Channel ID
 * @module dataManager
 */
module.exports = {
	/**
	 * Locate the Discord Channel ID associated with a given Slack Channel ID from serverMap.json
	 * @param {string} slackChannelID The Slack Channel id. Can be obtained through event.channel
	 * @param {boolean} [sendDefault = false] Whether or not to lookup the default logging channel set up in serverMap.json if the searched channel is not found. May cause silent problems if serverMap.channelMap.default is not set up properly
	 * @returns {string|undefined} Returns the Discord Channel ID associated with the Slack Channel. If that is not found, the default channel ID is returned if it is being used or nothing at all
	 */
	getChannel,
	/**
	 * Adds a channel to the serverMap and saves it to the JSON file. Will attempt to save up to 5 times. Change the number in the source code if you would like to
	 * @param {string} slackChannelID ID for the Slack Channel to map or remap
	 * @param {string} discordChannelID ID for the Discord Channel to map the Slack Channel to
	 */
	mapChannel,
	/**
	 * Loads the serverMap from its JSON file if it exists and creates it if it doesn't
	 * @async
	 */
	load
};

async function load() {
	try {
		await fs.promises.writeFile(serverMapPath, JSON.stringify(data), { flag: "wx" });
		console.log(`Created Server Map at ${serverMapPath}`);
	} catch(loadErr) {
		if(loadErr.code === 'EEXIST') {
			const serverMapFile = await fs.promises.readFile(serverMapPath);
			Object.assign(data, JSON.parse(serverMapFile));
			return;
		}
		throw `Problem Encountered While Loading ServerMap from ${serverMapPath}\n${loadErr}`;
	}
}

/**
 * Saves the current serverMap its JSON file
 * @param {number} [retry = 0] Number of times to try and save again if saving fails (Most likely pointless since if it fails once, it'll probably fail again for the same reason)
 * @param {string} [successText] Printed out if save attempt is successful
 * @param {boolean} [throwOnFail = false] If set to true, the function will throw an error if it fails to save. Otherwise, it will fail silently by default
 */
function save(retry = 0, successText, throwOnFail = false) {
	let saveThis = JSON.stringify(data);
	fs.writeFile(serverMapPath, saveThis, (err) => {
		if(err) {
			console.warn(`ERROR! ${err}`);
			if(typeof retry === "number" && retry > 0) {
				save(retry - 1);
			} else {
				console.warn(`Data Dump:\n${saveThis}`);
				if(throwOnFail) throw "Failed to Save Map";
				else return;
			}
		}
		if(successText) console.log(successText);
	});
}

function getChannel(slackChannelID, sendDefault = false) {
	return data.channelMap[slackChannelID] || (sendDefault ? data.channelMap.default : undefined);
}

function mapChannel(slackChannelID, discordChannelID) {
	data.channelMap[slackChannelID.toString()] = discordChannelID.toString();
	save(5/*, `Successfully Mapped ${slackChannelID} to ${discordChannelID}`*/);
}