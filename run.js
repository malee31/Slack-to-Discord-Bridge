require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const {WebClient} = require("@slack/web-api");
const Discord = require("discord.js");
const client = new Discord.Client();
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

const downloadsFolder = path.resolve(__dirname, "downloads");

// Initialize a server using the event adapter's request listener
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = http.createServer(slackEvents.requestListener());

const web = new WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
let botAuthData;
let loggingGuild;

async function startUp() {
	const pendingPromises = [];
	pendingPromises.push(await web.conversations.list().then(channelList => {
		for(const channel of channelList.channels) {
			if(channel.is_channel && !channel.is_member) pendingPromises.push(web.conversations.join({channel: channel.id}));
		}
	}));

	pendingPromises.push(web.auth.test().then(auth => {
		botAuthData = auth;
	}))

	server.listen(Number(process.env.PORT) || 3000, () => {
		console.log(`Listening for events on ${server.address().port}`);
	});

	pendingPromises.push(client.login(process.env.DISCORD_TOKEN).then(() => {
		loggingGuild = client.guilds.cache.find(guild => guild.id === process.env.DISCORD_GUILD_ID);
	}));

	return Promise.all(pendingPromises);
}

slackEvents.on("message", async event => {
	if((event["bot_id"] && event["bot_id"] === botAuthData["bot_id"]) || (event.user && event.user === botAuthData.user_id) || (event.subtype && event.subtype === "bot_message")) return;
	console.log(event.text);

	if(event.files) {
		let downloads = [];
		console.log("ATTEMPTING FILE DOWNLOAD");
		for(const fileObj of event.files) {
			downloads.push(fileDownload(fileObj));
		}

		downloads = await Promise.all(downloads);
		downloads = downloads.map(val => val.path);
		console.log({files: downloads});

		if(event.text) {
			await loggingGuild.channels.cache.get(process.env.DISCORD_LOG_CHANNEL_ID).send(event.text, {files: downloads});
		} else {
			await loggingGuild.channels.cache.get(process.env.DISCORD_LOG_CHANNEL_ID).send({files: downloads});
		}
	} else if(event.text) {
		await loggingGuild.channels.cache.get(process.env.DISCORD_LOG_CHANNEL_ID).send(event.text);
	}
});

let pendingDownloads = [];
async function fileDownload(fileObj, fileName) {
	fileName = fileName || fileObj.name;
	let copyCount = 0;
	let split = fileName.split(".");
	let fileFormat = {extension: fileName.includes(".") ? split.pop() : "", name: split.join(".")};
	while(true) {
		let testFileName = `${fileFormat.name}${copyCount ? ` (${copyCount})` : ""}.${fileFormat.extension}`;
		let testPath = path.resolve(downloadsFolder, testFileName);
		try {
			await fs.promises.access(testPath, fs.constants.F_OK);
			console.log(`File: ${testPath} already exists.\nAppending number to path and trying again`);
			copyCount++;
		} catch(err) {
			if(err.code === "ENOENT") {
				if(pendingDownloads.includes(testPath)) {
					console.log(`Download named ${testPath} is already pending.\nAppending number to path and trying again`);
					copyCount++;
					continue;
				} else {
					fileName = testFileName;
					break;
				}
			}
			console.warn("Unknown error while looking for a path to store download: ", err);

			// Arbitrary number used as limit
			if(copyCount > 200) throw "Could not download file after 200 attempts. Rejecting Promise.";
		}
	}

	let finalDownloadPath = path.resolve(downloadsFolder, fileName)
	pendingDownloads.push(finalDownloadPath);

	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(path.resolve(downloadsFolder, fileName));
		const request = https.get(fileObj["url_private_download"], {
			headers: {
				Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN}`
			}
		}, response => {
			response.pipe(file);
			file.on('finish', async() => {
				await file.close();
				console.log(`Download Complete. Removing path from cache: ${finalDownloadPath}`);
				console.log(pendingDownloads);
				pendingDownloads.splice(pendingDownloads.indexOf(finalDownloadPath), 1);
				console.log(pendingDownloads);
				resolve({
					name: fileObj.name,
					title: fileObj.title,
					storedAs: fileName,
					path: file.path
				});
			});
		});

		request.on("error", async err => {
			// Delete the file asynchronously on fail. Doesn't check the result
			await fs.promises.unlink(path.resolve(downloadsFolder, fileName).catch(err2 => {
				if(err2) reject(`Download Failed and Unlink Failed: ${err2}`);
			}));
			reject(`Download Failed: ${err}`);
		});
	});
}

startUp().then(() => {
	console.log("Start Up Complete");
}).catch(err => {
	console.warn("Failed to Start Up. Shutting Down");
	console.error(err);
});

client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
	client.user.setPresence({
		activity: {
			type: "LISTENING",
			name: "You While Being Updated"
		},
		status: "online",
		afk: false
	})
	.then(() => {
		console.log("Successfully Set Presence");
	}).catch(err => {
		console.warn("Failed to Set Presence");
		console.error(err);
	});
});

client.once("disconnect", () => {
	console.log("Disconnecting. Goodbye!");
});