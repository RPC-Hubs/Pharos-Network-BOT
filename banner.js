import chalk from 'chalk';
import figlet from 'figlet';
import os from 'os';

function centerText(text, width = null) {
    if (width === null) {
        try {
            width = process.stdout.columns || 80;
        } catch {
            width = 80;
        }
    }
    if (text.length >= width) return text;
    const pad = Math.floor((width - text.length) / 2);
    return ' '.repeat(pad) + text;
}

export function displayBanner() {
    let width = 80;
    try { width = process.stdout.columns; } catch {}

    const asciiBanner = [
        "██████╗ ██████╗  ██████╗    ██╗  ██╗██╗   ██╗██████╗ ███████╗",
        "██╔══██╗██╔══██╗██╔════╝    ██║  ██║██║   ██║██╔══██╗██╔════╝",
        "██████╔╝██████╔╝██║         ███████║██║   ██║██████╔╝███████╗",
        "██╔══██╗██╔═══╝ ██║         ██╔══██║██║   ██║██╔══██╗╚════██║",
        "██║  ██║██║     ╚██████╗    ██║  ██║╚██████╔╝██████╔╝███████║",
        "╚═╝  ╚═╝╚═╝      ╚═════╝    ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝"
    ];

    const now = new Date();
    const dateStr = now.toLocaleString("en-GB", { hour12: false });

    const banner = '\n'
        + asciiBanner.map(line => chalk.cyan(centerText(line, width))).join('\n') + '\n'
        + chalk.yellow(centerText("PHAROS NETWORK BOT 🚰", width)) + '\n'
        + centerText(chalk.red("📢 Telegram Channel: https://t.me/RPC_Hubs"), width) + '\n\n'
        + chalk.yellow(centerText("════════════════════════════════════════════════════════", width)) + '\n'
        + centerText(`Started at: ${chalk.white(dateStr)}`, width) + '\n'
        + chalk.yellow(centerText("════════════════════════════════════════════════════════", width)) + '\n';

    console.log(banner);
}
