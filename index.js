require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    ChannelType, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// ==========================================
// 1. KONFIGURASI BOT DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates // WAJIB ADA BUAT J2C
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Variable Memory untuk J2C (Join to Create)
const tempChannels = new Map(); 

// ==========================================
// 2. KONFIGURASI WEB DASHBOARD (EXPRESS)
// ==========================================
// Middleware
app.use(express.static('public')); // Folder CSS/Gambar
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Koneksi Database
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// Route Dashboard (Contoh Sederhana)
app.get('/', (req, res) => {
    res.render('dashboard', { 
        botName: client.user ? client.user.username : "MeWoAI",
        memberCount: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)
    });
});

// Jalankan Web Server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🌐 Web Dashboard berjalan di Port: ${PORT}`);
});

// ==========================================
// 3. LOGIKA BOT DISCORD (EVENT LISTENER)
// ==========================================

client.once('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} Sudah Online!`);
    client.user.setActivity('Memantau Server 24/7');
});

// --- FITUR VOICE GENERATOR (J2C) ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Ambil ID dari .env
    const J2C_CHANNEL = process.env.J2C_CHANNEL_ID;
    const J2C_CATEGORY = process.env.J2C_CATEGORY_ID;

    // A. LOGIKA MEMBUAT CHANNEL BARU
    if (newState.channelId === J2C_CHANNEL) {
        try {
            // Buat Channel Baru
            const channel = await newState.guild.channels.create({
                name: `🎧 Room ${newState.member.user.username}`,
                type: ChannelType.GuildVoice,
                parent: J2C_CATEGORY,
                permissionOverwrites: [
                    {
                        id: newState.member.id,
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels],
                    },
                    {
                        id: newState.guild.id,
                        allow: [PermissionFlagsBits.Connect],
                    },
                ],
            });

            // Pindahkan Member ke Channel Baru
            await newState.member.voice.setChannel(channel);

            // Simpan Data Owner di Memory
            tempChannels.set(channel.id, { owner: newState.member.id, timer: null });

            // Kirim Panel Kontrol (Tombol) ke Chat Voice Channel Tersebut
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('v_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('v_unlock').setLabel('🔓 Unlock').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('v_limit').setLabel('👥 Limit').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('v_rename').setLabel('✏️ Rename').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('v_kick').setLabel('🚫 Kick').setStyle(ButtonStyle.Danger)
                );

            await channel.send({ 
                content: `👋 Halo <@${newState.member.id}>! Ini ruang suaramu.\nGunakan tombol di bawah untuk mengatur ruangan.`, 
                components: [row] 
            });

        } catch (err) {
            console.error("Gagal membuat J2C:", err);
        }
    }

    // B. LOGIKA HAPUS CHANNEL KOSONG (AUTO-DELETE)
    if (oldState.channelId && tempChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        
        // Cek apakah channel kosong (0 orang)
        if (channel.members.size === 0) {
            // Mulai Timer 1 Menit (60.000 ms) sebelum hapus
            const timer = setTimeout(async () => {
                if (channel && tempChannels.has(channel.id)) { // Cek lagi
                    try {
                        await channel.delete();
                    } catch (e) {
                        console.log('Channel sudah hilang duluan.');
                    }
                    tempChannels.delete(channel.id);
                }
            }, 60000); // 1 Menit

            // Simpan timer
            const data = tempChannels.get(oldState.channelId);
            if(data) data.timer = timer;
        }
    }

    // C. BATALKAN HAPUS JIKA ADA YANG JOIN LAGI
    if (newState.channelId && tempChannels.has(newState.channelId)) {
        const data = tempChannels.get(newState.channelId);
        if (data && data.timer) {
            clearTimeout(data.timer);
            data.timer = null;
        }
    }
});

// --- INTERAKSI TOMBOL PANEL VOICE ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('v_')) return;

    // Cek apakah ini channel J2C
    const channelData = tempChannels.get(interaction.channelId);
    if (!channelData) return interaction.reply({ content: '❌ Fitur ini hanya untuk Room Temp.', ephemeral: true });

    // Cek Owner
    if (interaction.user.id !== channelData.owner) {
        return interaction.reply({ content: '❌ Hanya pemilik room yang bisa atur ini!', ephemeral: true });
    }

    const channel = interaction.channel;

    if (interaction.customId === 'v_lock') {
        await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
        interaction.reply({ content: '🔒 Room dikunci untuk publik!', ephemeral: true });
    } 
    else if (interaction.customId === 'v_unlock') {
        await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true });
        interaction.reply({ content: '🔓 Room dibuka untuk publik!', ephemeral: true });
    }
    else if (interaction.customId === 'v_limit') {
        let limit = channel.userLimit;
        let newLimit = limit === 0 ? 2 : (limit === 2 ? 5 : (limit === 5 ? 10 : 0));
        await channel.setUserLimit(newLimit);
        interaction.reply({ content: `👥 Limit: ${newLimit === 0 ? 'Tanpa Batas' : newLimit + ' orang'}`, ephemeral: true });
    }
    else if (interaction.customId === 'v_rename') {
        interaction.reply({ content: '✏️ Ketik nama baru (15 detik)...', ephemeral: true });
        const filter = m => m.author.id === interaction.user.id;
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
            await channel.setName(collected.first().content);
            collected.first().delete();
            interaction.followUp({ content: `✅ Sukses ganti nama!`, ephemeral: true });
        } catch (e) {
            interaction.followUp({ content: '❌ Waktu habis.', ephemeral: true });
        }
    }
    else if (interaction.customId === 'v_kick') {
        interaction.reply({ content: '🚫 Tag orang yang mau di-kick (15 detik)...', ephemeral: true });
        const filter = m => m.author.id === interaction.user.id;
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
            const mention = collected.first().mentions.members.first();
            if (mention) {
                await mention.voice.disconnect();
                interaction.followUp({ content: `👋 Bye ${mention.user.username}!`, ephemeral: true });
            }
            collected.first().delete();
        } catch (e) {
            interaction.followUp({ content: '❌ Gagal/Waktu habis.', ephemeral: true });
        }
    }
});

// ==========================================
// 4. LOGIN BOT
// ==========================================
client.login(process.env.TOKEN);
