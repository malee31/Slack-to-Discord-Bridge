const data = require("./serverMap.json");
const fs = require('fs');

module.exports = {
	getChannel,
	mapChannel
}

function save(retry = 0, successText, throwOnFail = false) {
	let saveThis = JSON.stringify(data);
	fs.writeFile(`${__dirname}/serverMap.json`, saveThis, (err) => {
		if(err) {
			console.warn(`ERROR! ${err}`);
			if(typeof retry === "number" && retry > 0) {
				save(retry - 1);
			} else {
				console.warn(`Data Dump: ${JSON.stringify(data)}`);
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