Slack to Discord Bridge
=======================
# Purpose
This repository contains the source code for a Slack App that listens to a Slack Workspace's public channels and forwards its messages and files to a Discord server as a back-up or archive.

# Slack App Set-Up
To set up the Slack App, first clone this repository and run `npm install` to install the dependencies required.<br>
Next, go to create your own Slack App on the [Slack Developers page](https://api.slack.com/apps) <br>
Before configuring the project, make a copy of `template.env` and name it `.env` <br>
Configure the project by editing the `.env` file and adding your Slack App's credentials. Install your Slack App to your Slack Workspace and give it the scopes it will need to function (Most :read scopes, user.info, and more. Will update list later).<br>
You will need to follow Slack's instructions to link up the Request URL on the Slack App page to the project. <br>
You will need to open up a port to the internet by port-forwarding or using a service like ngrok.<br>
Then run the script in `node_modules/.bin/slack-verify` and validate the url you give Slack before running<br>
`(Warning, if your URL changes you will have to do this step again. Ngrok Free Plan changes the url each time it is restarted so keep it running in another terminal or the background)`<br>

# Discord Bot Set-Up
Go to the [Discord Developers Portal](https://discord.com/developers/applications) and create a new bot<br>
Find the `Client ID` in the `General Information` page and replace the braces in this url with it to invite it to the Discord Server you want to use with Admin permissions(Required): https://discord.com/oauth2/authorize?client_id={Client_ID_Goes_Here}&scope=bot&permissions=8 <br>
Next, go to the `Bot` page and reveal the `TOKEN` for the bot. <br>
Copy it and paste it into the `DISCORD_TOKEN` field of the `.env` file <br>
Fill out the remaining fields of the `.env` file from the Slack App Set-Up and get ready to run it! <br>
Optional: Customize the bot by giving it a name, profile picture, and description on the `General Information` page<br>

# Set-Up Complete! Now let's run it
At last, run `node .` and the Discord Bot and Slack App will both boot up.<br>
Send a message in a Slack channel that the Slack App is able to read and watch as the message appears on Discord as well!

# Documentation
First complete all the steps listed above to set up the app.<br>
Generate the documentation for the project code by running `npm run jsdoc` then view them by running `npm run jsdoc-serve` and going to the printed link while the http-server is running.