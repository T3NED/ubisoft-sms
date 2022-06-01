import "dotenv/config";
import { Client, Collection, Intents, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import Axios from "axios";

const userToOrder = new Collection<string, string>();
const orderToUser = new Collection<string, string>();

const axios = Axios.create({
	baseURL: "https://www.smspool.net/api",
	params: {
		key: process.env.API_KEY,
	},
});

const channelId = process.env.DISCORD_CHANNEL_ID ?? "";

const client = new Client<true>({
	intents: new Intents(["GUILD_MESSAGES", "GUILD_MEMBERS", "GUILDS"]),
});

const getSMSBalance = async () => {
	const response = await axios.get("/request/balance");
	return response.data.balance || "0.00";
};

const getSMSPrice = async () => {
	const response = await axios.get("/request/price", {
		params: {
			country: "us",
			service: "ubisoft",
		},
	});

	return response.data.price || "0.00";
};

const buySMSNumber = async () => {
	const response = await axios.post("/purchase/sms", null, {
		params: {
			country: "us",
			service: "ubisoft",
		},
	});

	return response.data?.message
		? [response.data.message]
		: [response.data?.order_id, response.data?.number];
};

const checkOrder = async (orderId: string) => {
	const response = await axios.get("/sms/check", {
		params: {
			orderid: orderId,
		},
	});

	if (response.data.status === 3) {
		const user = orderToUser.get(orderId);
		if (user) userToOrder.delete(user);
		orderToUser.delete(orderId);
		return response.data.sms;
	}

	if (response.data.status !== 1) {
		const user = orderToUser.get(orderId);
		if (user) userToOrder.delete(user);
		orderToUser.delete(orderId);
	}

	return null;
};

const getMessage = async () => {
	const channel = client.channels.cache.get(channelId);
	if (!channel || !channel.isText()) return null;

	const message = await channel.messages
		.fetch({ limit: 10 })
		.then((messages) => messages.filter((msg) => !!msg.embeds[0] && msg.author.id === client.user.id));
	if (!message.first()) return null;

	return message.first();
};

const createMessage = async () => {
	const channel = client.channels.cache.get(channelId);
	if (!channel || !channel.isText()) return null;

	const embed = new MessageEmbed()
		.setAuthor({
			name: client.user.username,
			iconURL: client.user.displayAvatarURL(),
			url: "https://www.smspool.net/",
		})
		.setDescription("Click the button below to get a phone number!")
		.setURL("https://www.smspool.net/")
		.setColor(0xa7c7e7);

	const message = await channel.send({
		embeds: [embed],
		components: [
			new MessageActionRow().addComponents(
				new MessageButton()
					.setCustomId("sms")
					.setEmoji("📱")
					.setLabel("Get SMS code")
					.setStyle("PRIMARY"),
			),
		],
	});

	return message;
};

const getOrCreateMessage = async () => {
	const message = await getMessage();
	if (message) return message;
	return createMessage();
};

const updateMessage = async () => {
	const balance = await getSMSBalance();
	const price = await getSMSPrice();
	const message = await getOrCreateMessage();

	const embed = new MessageEmbed()
		.setAuthor({
			name: client.user.username,
			iconURL: client.user.displayAvatarURL(),
			url: "https://www.smspool.net/",
		})
		.setDescription(
			[
				`Click the button below to get a phone number!\n`,
				`**Balance:** $${balance}`,
				`**Price per number:** $${price}`,
			].join("\n"),
		)
		.setColor(0xa7c7e7);

	return message?.edit({
		embeds: [embed],
		components: [
			new MessageActionRow().addComponents(
				new MessageButton()
					.setCustomId("sms")
					.setEmoji("📱")
					.setLabel("Get SMS code")
					.setStyle("PRIMARY"),
			),
		],
	});
};

const notifyUser = async (userId: string, code: string) => {
	const channel = client.channels.cache.get(channelId);
	if (!channel || !channel.isText()) return null;

	return channel
		.send({
			content: `<@${userId}> Your code is \`${code}\``,
		})
		.then((msg) => setTimeout(() => msg.delete(), 120_000));
};

client.once("ready", async () => {
	console.log("Logged in as", client.user.tag);
	await updateMessage();

	setInterval(() => updateMessage(), 20_000);

	setInterval(async () => {
		for (const [orderId, userId] of orderToUser.entries()) {
			const code = await checkOrder(orderId);
			if (!code) continue;
			notifyUser(userId, code);
		}
	}, 5000);
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isButton() || interaction.customId !== "sms") return;

	await interaction.deferReply({ ephemeral: true });

	if (userToOrder.has(interaction.user.id)) {
		interaction.editReply({
			content: "You have already ordered a number. You will be notified when a code is received!",
		});
		return;
	}

	const [orderId, number] = await buySMSNumber();

	if (!number) {
		interaction.editReply({ content: orderId });
		return;
	}

	userToOrder.set(interaction.user.id, orderId);
	orderToUser.set(orderId, interaction.user.id);

	await updateMessage();

	interaction.editReply({ content: `Your phone number is \`+${number}\`` });
});

client.login(process.env.DISCORD_TOKEN);
