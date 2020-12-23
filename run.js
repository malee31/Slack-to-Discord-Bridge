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
	if((event["bot_id"] && event["bot_id"] === botAuthData["bot_id"]) || (event.user && event.user === botAuthData.user_id)) return;
	if(event.subtype && event.subtype !== "file_share") {
		switch(event.subtype) {
			case "bot_message":
				console.log("BOT MESSAGE - ABORT");
				return;
			case "message_deleted":
				console.log(`Message Deleted - ${event.hidden ? " - HIDDEN" : ""}`);
				break;
			case "message_changed":
				console.log("Message Change");
				for(const messageAttachment in event.message.attachments) {
					await (await locateChannel(event.channel)).send(slackEmbedParse(event.message.attachments[0]));
				}
				return;
			default:
				console.warn(`Unknown Message Subtype ${event.subtype}`);
		}
		console.log(event);
		console.log("====================\n");
		return;
	}

	const targetChannel = await locateChannel(event.channel);
	const user = (await web.users.info({user: event.user})).user;
	const embeds = [new Discord.MessageEmbed()
		// .setTitle("A Slack Message")
		.setTimestamp(event.ts * 1000)
		.setAuthor(userIdentify(user), user.profile["image_512"])
		.setColor(`#${user.color}` || "#283747")];
	if(event.text) embeds[0].setDescription(await slackTextParse(event.text));

	if(!event.files) {
		await embedSender(targetChannel, embeds);
		return;
	}

	let downloads = [];
	console.log("ATTEMPTING FILE DOWNLOAD");
	for(const fileObj of event.files) {
		downloads.push(fileManager.fileDownload(fileObj));
	}

	downloads = await Promise.all(downloads);

	embeds[0].attachFiles({
		attachment: downloads[0].path,
		name: downloads[0].name
	}).setImage(`attachment://${downloads[0].name}`);

	if(downloads.length > 1) {
		embeds[0].setFooter(`↓ Message Includes ${downloads.length - 1} Additional Attachment${downloads.length === 2 ? "" : "s"} Below ↓`);
		embeds.push({files: downloads.slice(1).map(val => val.path)});
	}

	await embedSender(targetChannel, embeds);

	await Promise.all(downloads.map(downloadPath => fileManager.fileDelete(downloadPath.path)));
});

async function embedSender(discordChannel, discordEmbeds) {
	for(const discordEmbed of discordEmbeds) {
		await discordChannel.send(discordEmbed);
	}
}

async function locateChannel(slackChannelID) {
	let targetChannel = loggingGuild.channels.cache.get(dataManager.getChannel(slackChannelID));
	if(!targetChannel) {
		const channelInfo = await web.conversations.info({channel: slackChannelID});
		// Quirk: First occurrence of channel with the same name on Discord is used. The second occurrence is ignored
		targetChannel = loggingGuild.channels.cache.find(channel => channel.type === "text" && channel.name === channelInfo.channel.name);
		if(!targetChannel) targetChannel = await loggingGuild.channels.create(channelInfo.channel.name, {reason: `#${channelInfo.channel.name} created for new Slack Messages`});
		if(!targetChannel) {
			// Use the line below instead of throwing if there is a default channel you would like to send to set in serverMap.
			// loggingChannel = loggingGuild.channels.cache.get(dataManager.getChannel(event.channel, true));
			throw `Channel #${channelInfo.channel.name} could not be found or created.`;
		}
		dataManager.mapChannel(slackChannelID, targetChannel.id);
	}
	return targetChannel;
}

function slackEmbedParse(embed) {
	let discordEmbed = new Discord.MessageEmbed();
	discordEmbed
		.setTitle(embed.title)
		.setURL(embed.title_link)
		.setDescription(embed.text || embed.fallback)
		.setImage(embed.image_url)
		.setAuthor(embed["service_name"], embed["service_icon"], embed["original_url"]);
	return discordEmbed;
}

async function slackTextParse(text) {
	// Regex differs slightly from official regex defs_user_id in https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json
	// Known Bugs:
	// * Slow. Each mention slows down parsing significantly
	let mentions = text.match(/(?<=<@)[UW][A-Z0-9]{8}([A-Z0-9]{2})?(?=>)/g);
	if(mentions) {
		let identify = mentions.filter((id, index) => mentions.indexOf(id) === index).map(id => {
			return web.users.info({user: id});
		});
		(await Promise.all(identify)).forEach(userInfo => {
			text = text.replace(new RegExp(`<@${userInfo.user.id}>`, 'g'), `[${userIdentify(userInfo.user)}]`);
		});
	}

	// URL Slack to Discord Markdown Translation
	// Known Bugs:
	// * Including the character '>' in any part of the link's text will make the translation cut off early
	// * Certain non-urls will not parse correctly for some odd reason. For example, Slack will try to auto-encode text into a URL if it is entered as one and that won't sit well with Discord
	let urls = text.match(/(?<=<)https?:\/\/[\w@:%.\/+~#=]+(|.+?)?(?=>)/g);
	if(urls) {
		urls.map(link => {
			let split = link.split("|");
			text = text.replace(`<${link}>`, `[${split[1] && split[1].trim().length > 0 ? split[1].trim() : split[0]}](${split[0]})`);
		});
	}

	// Strikethrough Slack to Discord Markdown Translation
	// Known Bugs:
	// * Using Ctrl + Z on Slack to undo ~strikethrough~ markdown results in that undo being ignored on Discord. Escaped markdown is parsed as if it was never escaped
	text = text.replace(/~~/g, "\\~\\~").replace(/(?<=^|\s)(~(?=[^\s])[^~]+(?<=[^\s])~)(?=$|\s)/g, "~$1~");

	// Unescaping HTML Escapes created by Slack's API
	// Known Bugs:
	// * Literally typing any of the following HTML escape codes normally will result in them being converted over to their unescaped form on Discord
	// - Typing &gt; on Slack translates to > on Discord
	// - Typing &lt; on Slack translates to < on Discord
	// - Typing &amp; on Slack translates to &on Discord
	text = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

	// Additional Known Bugs:
	// * When using code blocks, if ```OneWord syntax is used on Slack, the first word is invisible when sent to Discord
	console.log(text);
	return text;
}

function userIdentify(user) {
	return `${user.real_name}@${user.id}`;
}

client.once("disconnect", () => {
	console.log("======= Disconnecting. Goodbye! =======");
	process.exit(1);
});

async function startUp() {
	console.log("============= Starting Up =============");
	const pendingPromises = [];
	pendingPromises.push(await web.conversations.list().then(channelList => {
		for(const channel of channelList.channels) {
			if(channel["is_channel"] && !channel["is_member"]) pendingPromises.push(web.conversations.join({channel: channel.id}));
		}
		console.log("======== Slack Channels Joined ========");
	}));

	pendingPromises.push(web.auth.test().then(auth => {
		botAuthData = auth;
		console.log("======= Slack App Data Retrieved ======");
	}))

	server.listen(Number(process.env.PORT) || 3000, () => {
		console.log(`========== Started Port ${server.address().port} ==========`);
	});

	pendingPromises.push(client.login(process.env.DISCORD_TOKEN).then(() => {
		console.log(`===== Logged in as ${client.user.tag} ====`);
		client.user.setPresence({
			activity: {
				type: "LISTENING",
				name: "To Slack Messages"
			},
			status: "online",
			afk: false
		}).then(() => {
			console.log("====== Successfully Set Presence ======");
			console.log("========== Discord Bot Ready ==========");
		}).catch(err => {
			console.log("========== Discord Bot Ready ==========");
			console.warn("⚠⚠⚠⚠⚠ Failed to Set Presence ⚠⚠⚠⚠⚠");
			console.error(err);
		});

		loggingGuild = client.guilds.cache.find(guild => guild.id === process.env.DISCORD_GUILD_ID);
	}));

	return Promise.all(pendingPromises);
}

startUp().then(() => {
	console.log("========== Start Up Complete ==========");
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});