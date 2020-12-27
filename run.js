require("dotenv").config();
const {createEventAdapter} = require("@slack/events-api");
const dataManager = require("./dataManager.js");
const {WebClient} = require("@slack/web-api");
const databaseManager = require("./database");
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

	if(event.text === "SQL_Test") {
		console.log("SQL TEST DETECTED");
		databaseManager.dataDump();
	}

	const targetChannel = await locateChannel(event.channel);
	const user = (event.user ? (await web.users.info({user: event.user})).user : undefined);
	const embeds = [userMessageEmbed(user, event.ts)];

	// Default Text Assembly
	if(event.text) embeds[0].setDescription(await slackTextParse(event.text));

	switch(event.subtype) {
		case "bot_message":
			console.warn("BOT MESSAGE - ABORT");
			return;
		case "message_deleted":
			await Promise.all((await databaseManager.locateMaps(identify(event.channel, event.previous_message.ts))).map(DMID => {
				return targetChannel.messages.fetch(DMID["DiscordMessageID"]).then(message => message.delete());
			}));
			return;
		case "message_changed":
			console.log("Message Change");
			for(const messageAttachment in event.message.attachments) {
				await targetChannel.send(slackEmbedParse(event.message.attachments[0]));
			}
			break;
		case "file_share":
			let downloads = await attachmentEmbeds(embeds, event.files);

			await embedSender(targetChannel, embeds, identify(event.channel, event.ts));

			await Promise.all(downloads.map(downloadPath => fileManager.fileDelete(downloadPath.path)));
			break;
		case undefined:
			// Standard Text Message Embed Already Handled Pre-Switch Statement
			await embedSender(targetChannel, embeds, identify(event.channel, event.ts));
			break;
		default:
			console.warn(`Unknown Message Subtype ${event.subtype}`);
	}
});

async function attachmentEmbeds(embedArr, slackFiles) {
	let downloads = [];
	console.log("ATTEMPTING FILE DOWNLOAD");
	for(const fileObj of slackFiles) {
		downloads.push(fileManager.fileDownload(fileObj));
	}

	downloads = await Promise.all(downloads);

	let sliceNum = 1;

	switch(downloads[0].extension.toLowerCase().trim()) {
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "gifv":
		case "webm":
		case "mp3":
		case "mp4":
		case "ogg":
		case "wav":
		// Lacks support in some devices
		// case "mov":
		// case "flac":
			embedArr[0].attachFiles({
				attachment: downloads[0].path,
				name: downloads[0].name
			}).setImage(`attachment://${downloads[0].name}`);
			break;
		default:
			sliceNum = 0;
	}

	if(downloads.length > sliceNum) {
		embedArr[0].setFooter(`↓ Message Includes ${downloads.length - sliceNum} Additional Attachment${downloads.length === 2 ? "" : "s"} Below ↓`);
		embedArr.push({files: downloads.slice(sliceNum).map(val => val.path)});
	}

	return downloads;
}

function userMessageEmbed(user, time) {
	const userEmbed = new Discord.MessageEmbed()
		// .setTitle("A Slack Message")
		.setAuthor((user ? userIdentify(user) : "Unknown Pupper"), (user && user.profile && user.profile["image_512"] ? user.profile["image_512"] : "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif"))
		.setColor(user && user.color ? `#${user.color}` : "#283747");
	if(time) userEmbed.setTimestamp(time * 1000);
	return userEmbed;
}

async function embedSender(discordChannel, discordEmbeds, mapTo, pureText = true) {
	for(const discordEmbed of discordEmbeds) {
		let sentMessage = await discordChannel.send(discordEmbed);
		if(mapTo) {
			databaseManager.messageMap(mapTo, sentMessage.id, pureText, err => {
				if(err) console.log(`MAP ERROR:\n${err}`);
				console.log(`Mapped Slack ${mapTo} to Discord ${sentMessage.id}`);
			});
			pureText = false;
		}
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

// Use on a Slack event to generate an id for messages that SHOULD be unique (No official documentation found)
function identify(channel, ts) {
	return `${channel}/${ts}`;
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