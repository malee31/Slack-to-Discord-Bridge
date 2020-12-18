require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const {WebClient} = require("@slack/web-api");
const fileManager = require("./fileManager");
const Discord = require("discord.js");
const client = new Discord.Client();
const http = require("http");

// Initialize a server using the event adapter's request listener
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = http.createServer(slackEvents.requestListener());
const web = new WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
let botAuthData, loggingGuild;

slackEvents.on("message", async event => {
	if((event["bot_id"] && event["bot_id"] === botAuthData["bot_id"]) || (event.user && event.user === botAuthData.user_id) || (event.subtype && event.subtype === "bot_message")) return;

	const embed = new Discord.MessageEmbed().setColor("#283747").setTitle("A Slack Message").setTimestamp(event.ts * 1000);
	if(event.text) embed.setDescription(event.text);
	await loggingGuild.channels.cache.get(process.env.DISCORD_LOG_CHANNEL_ID).send(embed);
	if(event.files) {
		let downloads = [];
		console.log("ATTEMPTING FILE DOWNLOAD");
		for(const fileObj of event.files) {
			downloads.push(fileManager.fileDownload(fileObj));
		}

		downloads = await Promise.all(downloads);
		downloads = downloads.map(val => val.path);

		await loggingGuild.channels.cache.get(process.env.DISCORD_LOG_CHANNEL_ID).send({files: downloads});
		await Promise.all(downloads.map(downloadPath => fileManager.fileDelete(downloadPath)));
	}
});

client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
	client.user.setPresence({
		activity: {
			type: "LISTENING",
			name: "To Slack Messages"
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
	process.exit(1);
});

async function startUp() {
	const pendingPromises = [];
	pendingPromises.push(await web.conversations.list().then(channelList => {
		for(const channel of channelList.channels) {
			if(channel["is_channel"] && !channel["is_member"]) pendingPromises.push(web.conversations.join({channel: channel.id}));
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

startUp().then(() => {
	console.log("Start Up Complete");
}).catch(err => {
	console.warn("Failed to Start Up. Shutting Down");
	console.error(err);
});