const path = require("path");
const fs = require("fs");

const serverMapPath = path.resolve(__dirname, "serverMap.json");
const data = {
	channelMapComment: "Channel map is in Key(Slack Channel): Value(Discord Channel) Pairs. Set a default channel to send to if you are using that feature",
	channelMap: {
		default: "none"
	}
};

module.exports = {
	getChannel,
	mapChannel,
	load
}

async function load() {
	try {
		await fs.promises.writeFile(serverMapPath, JSON.stringify(data), {flag: "wx"});
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
	save(5, `Successfully Mapped ${slackChannelID} to ${discordChannelID}`);
}