const fs = require('fs');
const data = require("./database.json");

module.exports = {
	getChannel,
	mapChannel,
	saveInterval: setInterval(save, 2500)
}

function save() {
	let saveThis = JSON.stringify(data);
	fs.writeFile(`${__dirname}/../saveData.json`, saveThis, (err) => {
		if(err) {
			console.warn(`ERROR! ${err}`);
			console.warn(`Data Dump: ${JSON.stringify(data)}`);
		}
		//console.log('Data written to file');
	});
}

function getChannel(slackChannelID, sendDefault=false) {
	return data.channelMap[slackChannelID] || (sendDefault ? data.channelMap.default : undefined);
}

function mapChannel(slackChannelID, discordChannelID) {
	data.channelMap[slackChannelID.toString()] = discordChannelID.toString();
}