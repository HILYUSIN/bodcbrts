require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ChannelType, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);

// ==========================================
// 1. KONFIGURASI BOT & DATABASE
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const tempChannels = new Map(); 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Database Terhubung!'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// Definisikan Model User (Sesuaikan jika nama modelmu berbeda)
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String
}));

// ==========================================
// 2. ROUTE DASHBOARD (FIX ERROR PAGE & STATS)
// ==========================================
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', async (req, res) => {
    try {
        // Mengambil total data dari database untuk stats.total
        const totalRegistered = await User.countDocuments();

        res.render('dashboard', { 
            botName: client.user ? client.user.username : "MeWoAI",
            memberCount: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
            page: 'home', // Fix ReferenceError: page
            stats: {
                total: totalRegistered // Fix ReferenceError: stats
            }
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Terjadi kesalahan pada sistem dashboard.");
    }
});

const PORT = process.env.PORT || 10082;
http.listen(PORT, () => {
    console.log(`🚀 MEWOAI DASHBOARD RUNNING ON PORT ${PORT}`);
});

// ==========================================
// 3. LOGIKA VOICE GENERATOR (J2C)
// ==========================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const J2C_CHANNEL = process.env.J2C_CHANNEL_ID;
    const J2C_CATEGORY = process.env.J2C_CATEGORY_ID;

    if (newState.channelId === J2C_CHANNEL) {
        try {
            const channel = await newState.guild.channels.create({
                name: `🎧 Room ${newState.member.user.username}`,
                type: ChannelType.GuildVoice,
                parent: J2C_CATEGORY,
                permissionOverwrites: [
                    { id: newState.member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
                    { id: newState.guild.id, allow: [PermissionFlagsBits.Connect] },
                ],
            });

            await newState.member.voice.setChannel(channel);
            tempChannels.set(channel.id, { owner: newState.member.id, timer: null });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('v_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('v_limit').setLabel('👥 Limit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('v_rename').setLabel('✏️ Rename').setStyle(ButtonStyle.Secondary)
            );

            await channel.send({ content: `Halo <@${newState.member.id}>! Gunakan tombol untuk atur room.`, components: [row] });
        } catch (err) { console.error("J2C Error:", err); }
    }

    if (oldState.channelId && tempChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            setTimeout(async () => {
                if (channel && channel.members.size === 0) {
                    await channel.delete().catch(() => {});
                    tempChannels.delete(oldState.channelId);
                }
            }, 60000); 
        }
    }
});

client.once('clientReady', () => {
    console.log(`🤖 Bot ${client.user.tag} Sudah Online!`);
});

client.login(process.env.TOKEN);
