require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const dataManager = require("./dataManager.js");
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

	const user = (await web.users.info({user: event.user})).user;

	const embed = new Discord.MessageEmbed()
		// .setTitle("A Slack Message")
		.setTimestamp(event.ts * 1000)
		.setAuthor(`${user.real_name} [ID: @${user.id}]`, user.profile["image_512"])
		.setColor(`#${user.color}` || "#283747");
	if(event.text) embed.setDescription(event.text);
	// console.log(user);

	let loggingChannel = loggingGuild.channels.cache.get(dataManager.getChannel(event.channel));
	// console.log(await web.conversations.list());
	if(!loggingChannel) {
		const channelInfo = await web.conversations.info({channel: event.channel});
		// Quirk: First occurrence of channel with the same name on Discord is used. The second occurrence is ignored
		loggingChannel = loggingGuild.channels.cache.find(channel => channel.type === "text" && channel.name === channelInfo.channel.name);
		if(!loggingChannel) loggingChannel = await loggingGuild.channels.create(channelInfo.channel.name, {reason: `#${channelInfo.channel.name} created for new Slack Messages`});
		if(!loggingChannel) {
			// loggingChannel = loggingGuild.channels.cache.get(dataManager.getChannel(event.channel, true));
			throw `Channel #${channelInfo.channel.name} could not be found or created.`;
		}
		dataManager.mapChannel(event.channel, loggingChannel.id);
	}

	if(event.files) {
		let downloads = [];
		console.log("ATTEMPTING FILE DOWNLOAD");
		for(const fileObj of event.files) {
			downloads.push(fileManager.fileDownload(fileObj));
		}

		downloads = await Promise.all(downloads);

		embed.attachFiles({
			attachment: downloads[0].path,
			name: downloads[0].name
		}).setImage(`attachment://${downloads[0].name}`);

		if(downloads.length > 1) embed.setFooter(`↓ Message Includes ${downloads.length - 1} Additional Attachment${downloads.length === 2 ? "" : "s"} Below ↓`);
		await loggingChannel.send(embed);

		if(downloads.length > 1) await loggingChannel.send({files: downloads.slice(1).map(val => val.path)});

		console.log(downloads);
		await Promise.all(downloads.map(downloadPath => fileManager.fileDelete(downloadPath.path)));
	} else {
		await loggingChannel.send(embed);
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