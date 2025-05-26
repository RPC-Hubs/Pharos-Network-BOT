# 🚀 Pharos Network Automation Bot

<p align="center">
  <img src="https://img.shields.io/badge/Network-Pharos-blueviolet?style=for-the-badge&logo=ethereum" />
  <img src="https://img.shields.io/badge/Support-Telegram-blue?style=for-the-badge&logo=telegram" />
  <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge&logo=vercel" />
</p>

**Pharos-Network-BOT** is an advanced automation tool for interacting with the Pharos Testnet and Zenithswap, supporting tasks such as faucet claiming, checkin, USDC/PHRS swaps, sending PHRS to friends, and more.
Features proxy per-account, multicall, anti-block, custom threading, detailed logging, and retry logic.

---

## ✨ **Main Features**

* 🔹 Claim faucet (Pharos, Zenithswap)
* 🔹 Daily check-in auto
* 🔹 Swap tokens (PHRS ↔ USDC) with router multicall
* 🔹 Send PHRS to friends (auto-verify task)
* 🔹 Add LP (liquidity) for WPHRS/USDC V3 pool
* 🔹 Combine actions (all-in-one random/sequential)
* 🔹 Supports HTTPS proxy per wallet
* 🔹 Multi-threaded (customizable)
* 🔹 Cross-platform (Linux/macOS/Windows)
* 🔹 Colorful CLI UI, detailed log, retry & sleep logic

---

## ⚙️ **Requirements**

* Node.js **v18+** (recommend latest v20+)
* **npm** or **yarn**
* Git
* Compatible with: **Linux, macOS, Windows**

---

## 🛠️ **Installation**

### 🐧 Linux/macOS

```bash
# 1️⃣ Clone source code
git clone https://github.com/RPC-Hubs/Pharos-Network-BOT.git
cd Pharos-Network-BOT

# 2️⃣ Install dependencies
npm install

# 3️⃣ Prepare your input files
nano priv.txt
nano proxies.txt
nano walletsToSend.txt

# 4️⃣ Edit files: priv.txt, proxies.txt, walletsToSend.txt using your data.
```

---

### 🪟 Windows

```bat
:: 1️⃣ Download & install Node.js LTS (https://nodejs.org/)
:: 2️⃣ Clone the repo
git clone https://github.com/RPC-Hubs/Pharos-Network-BOT.git
cd Pharos-Network-BOT

:: 3️⃣ Install dependencies
npm install

:: 4️⃣ Edit priv.txt, proxies.txt, walletsToSend.txt with your data.
```

---

## 📝 **Configuring Input Files**

* **priv.txt**: One private key per line 
* **proxies.txt**: One proxy per line, format: `http://user:pass@ip:port` or `http://ip:port`
* **walletsToSend.txt**: List of addresses (friends/alt-wallets to send PHRS)

*Example:*

```
priv.txt
-------------------------
0xa2364db...
0x69dfee1...
...
```

```
proxies.txt
-------------------------
http://user:pass@123.123.123.123:5678
http://234.234.234.234:7890
...
```

```
walletsToSend.txt
-------------------------
0x_wallet_1
0x_wallet_2
...
```

---

## 💡 **How to Use**

### Start the bot

```bash
node main.js
```

or if your NodeJS is set up for ES modules:

```bash
npm start
```

---

### **Menu Functions Explained**

| Option | Feature                                        |
| ------ | ---------------------------------------------- |
| 1      | Faucet Pharos (claim) + daily checkin          |
| 2      | Faucet USDC via Zenithswap                     |
| 3      | Claim both (Pharos & Zenithswap)               |
| 4      | Swap PHRS <-> USDC                             |
| 5      | Send PHRS to random friends (with verify task) |
| 6      | Add LP (WPHRS/USDC)                            |
| 7      | Run ALL (4+5+6, random order, with sleep)      |
| 0      | Exit                                           |

For each function, follow prompts for amount, repeat, etc.

---

### **Typical Workflow**

1. **Select menu (e.g. 1 for Faucet Pharos)**
2. Enter requested params (min/max amount, repeat count)
3. Watch the log for process, result, and TX links

---

### **Logs & Output**

* Success/fail status is printed on CLI (color coded).
* `pharos_success.txt`, `pharos_failed.txt`, etc. are generated for tracking.

---

## 🧑‍💻 **Tips & Troubleshooting**

* Always use **fresh proxies** for best results (avoid bans/blocks).
* If “insufficient funds”/“not enough PHRS” log appears: top up wallet or reduce min amount.
* **Make sure you edit all input files** before running!

---

## 🎯 **Extra**

* All contract addresses/ABIs are in `contract_web3.js`
* For advanced users: tweak **THREADS**, retry, sleep params in `main.js`

---

## 🙋‍♂️ Community & Support

Join the team or get help here:

- 💬 [RPC Community Chat](https://t.me/chat_RPC_Community)  
- 📣 [RPC Hubs Channel](https://t.me/RPC_Hubs)  

---

> Made with ❤️ by RPC Hubs

## 💚 **Contribute**

PRs, feedback, or issues are welcome!

---

> Happy airdropping & farming Pharos Testnet!
