import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';
import fs from 'fs';
import { ethers } from 'ethers';
import { JsonRpcProvider } from "ethers";
import promptSync from 'prompt-sync';
import chalk from 'chalk';
import figlet from 'figlet';
import { displayBanner } from './banner.js';
import pLimit from 'p-limit';

// ========== CONFIG ==========
const THREADS = 100; 
const INVITE_CODE = "q9jlLnGjufi7ekjs";
const MAX_RETRIES = 5;
const SIGN_MESSAGE = "pharos";
const MIN_SLEEP = 10
const MAX_SLEEP = 60

const PRIV_FILE = "priv.txt";
const PROXIES_FILE = "proxies.txt";
const PHAROS_SUCCESS_FILE = "pharos_success.txt";
const PHAROS_FAILED_FILE = "pharos_failed.txt";
const USDC_SUCCESS_FILE = "usdc_success.txt";
const USDC_FAILED_FILE = "usdc_failed.txt";
const WALLETS_TO_SEND_FILE = "walletsToSend.txt";

const LOGIN_URL = "https://api.pharosnetwork.xyz/user/login";
const FAUCET_PHAROS_URL = "https://api.pharosnetwork.xyz/faucet/daily";
const CHECKIN_URL = "https://api.pharosnetwork.xyz/sign/in";
const GET_IP_URL = "https://api64.ipify.org?format=json";
const ZENITH_FAUCET_URL = "https://testnet-router.zenithswap.xyz/api/v1/faucet";
const ZENITH_TOKEN_ADDRESS = "0xAD902CF99C2dE2f1Ba5ec4D642Fd7E49cae9EE37";
const TASK_TIMEOUT = 60 * 1000;
const SAFE_TIMEOUT = 30 * 1000;
const TX_TIMEOUT = 60 * 1000;

process.on('unhandledRejection', (reason, promise) => {
    console.log('\n', '[GLOBAL] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.log('\n', '[GLOBAL] Uncaught Exception:', err);
});

// -------- Contract addresses/ABIs --------
import {
    PHAROS_RPC, CHAIN_ID,
    WPHRS_ADDRESS, USDC_ADDRESS, SWAP_ROUTER_ADDRESS,
    ERC20_ABI, SWAP_ROUTER_ABI, USDC_POOL_ADDRESS, LP_ROUTER_ADDRESS, LP_ROUTER_ABI, POOL_ABI
} from "./contract_web3.js";

const limit = pLimit(THREADS);

async function runParallelWithPLimit(fn, privs, proxies, repeat = 1, ...args) {
    for (let r = 0; r < repeat; r++) {
        if (repeat > 1) {
            console.log(
                chalk.cyan(
                    `\n================ [Batch ${r + 1} / ${repeat}] ================`
                )
            );
        }
        const tasks = privs.map((priv, idx) => {
            const proxy = proxies[idx % proxies.length];
            return limit(() => fn(idx + 1, priv, proxy, ...args));
        });
        await Promise.all(tasks);
    }
}


// ========== TOOL ==========
const prompt = promptSync({ sigint: true });

function nowStr() {
    const d = new Date();
    return `[${d.toLocaleTimeString()} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}]`;
}

function shortAddr(addr) {
    return addr.slice(0, 4) + "..." + addr.slice(-6);
}

function loadLines(path, {allowNullIfEmpty = false} = {}) {
    if (!fs.existsSync(path)) {
        return allowNullIfEmpty ? [null] : [];
    }
    const lines = fs.readFileSync(path, "utf8").split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0 && allowNullIfEmpty) return [null];
    return lines;
}

function getAxiosWithProxy(proxy) {
    if (!proxy) return axios.create({ timeout: 20000 });
    const agent = new HttpsProxyAgent(proxy);
    return axios.create({
        httpsAgent: agent,
        httpAgent: agent,
        timeout: 20000,
    });
}

function getProviderWithProxy(proxy) {
    if (proxy) {
        const agent = new HttpsProxyAgent(proxy);
        return new JsonRpcProvider(
            PHAROS_RPC,
            {
                chainId: CHAIN_ID,
                name: "Pharos Testnet", 
            },
            {
                fetchOptions: { agent }
            }
        );
    } else {
        return new JsonRpcProvider(
            PHAROS_RPC,
            {
                chainId: CHAIN_ID,
                name: "Pharos Testnet"
            }
        );
    }
}

async function getCurrentIp(proxy) {
    try {
        const client = getAxiosWithProxy(proxy);
        const { data } = await client.get(GET_IP_URL);
        return data.ip || "???";
    } catch (e) {
        return "???";
    }
}

// ========== MODULE 1 FAUCET/CHECKIN ==========
async function signMessage(privkey, message) {
    const wallet = new ethers.Wallet(privkey);
    const sig = await wallet.signMessage(message);
    return { address: wallet.address, signature: sig };
}
function getHeaders(jwt) {
    return {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${jwt}`,
        "Origin": "https://testnet.pharosnetwork.xyz",
        "Referer": "https://testnet.pharosnetwork.xyz/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    };
}
async function checkinPharos(address, jwt, proxy, prefix) {
    const client = getAxiosWithProxy(proxy);
    let retries = 0;
    const params = { address };
    while (retries < MAX_RETRIES) {
        try {
            const { data } = await client.post(
                CHECKIN_URL, {}, { params, headers: getHeaders(jwt) }
            );
            const msg = data?.msg || "";
            if (msg === "ok") {
                console.log(`${prefix} ${chalk.green("Pharos check-in successful!")}`);
                return true;
            } else if (msg === "already signed in today") {
                console.log(`${prefix} ${chalk.yellow("Already checked-in today.")}`);
                return true;
            } else {
                console.log(`${prefix} ${chalk.red("Pharos check-in failed: " + JSON.stringify(data))}`);
                retries++;
            }
        } catch (e) {
            console.log(`${prefix} ${chalk.red("Pharos check-in error: " + e.message)}`);
            retries++;
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

async function faucetPharos(idx, privkey, proxy) {
    const client = getAxiosWithProxy(proxy);
    let retry = 0;
    let acct_addr = "", jwt = "";
    let prefix = "";
    while (retry < MAX_RETRIES) {
        const { address, signature } = await signMessage(privkey, SIGN_MESSAGE);
        acct_addr = address;
        prefix = chalk.cyan(`${nowStr()} [${idx}] [${chalk.yellow(shortAddr(acct_addr))}]`);
        const ip = await getCurrentIp(proxy);
        console.log(`${prefix} Proxy IP: ${chalk.green(ip)} [Retry ${retry + 1}/${MAX_RETRIES}]`);

        try {
            const params = { address: acct_addr, signature, invite_code: INVITE_CODE };
            const { data } = await client.post(LOGIN_URL, null, { params, headers: getHeaders('null') });
            jwt = data?.data?.jwt;
            if (!jwt) throw new Error("No jwt returned");
            console.log(`${prefix} ${chalk.green("Login successful.")}`);
        } catch (e) {
            console.log(`${prefix} ${chalk.red("Login failed: " + e.message)}`);
            retry++;
            continue;
        }

        try {
            const params = { address: acct_addr };
            const { data } = await client.post(
                FAUCET_PHAROS_URL,
                {},
                { params, headers: getHeaders(jwt) }
            );
            const msg = data?.msg || "";

            if (msg === "ok") {
                console.log(`${prefix} ${chalk.green("Pharos faucet claim successful!")}`);
                fs.appendFileSync(PHAROS_SUCCESS_FILE, `${acct_addr}:${privkey}\n`);
                await checkinPharos(acct_addr, jwt, proxy, prefix);
                return true;
            } else if (msg === "faucet did not cooldown") {
                console.log(`${prefix} ${chalk.yellow("Faucet already claimed (cooldown).")}`);
                fs.appendFileSync(PHAROS_SUCCESS_FILE, `${acct_addr}:${privkey}\n`);
                await checkinPharos(acct_addr, jwt, proxy, prefix);
                return true;
            } else if (msg.includes("user has not bound X account")) {
                console.log(`${prefix} ${chalk.yellow("You need to bind X account to faucet")}`);
                await checkinPharos(acct_addr, jwt, proxy, prefix);
                fs.appendFileSync(PHAROS_FAILED_FILE, `${acct_addr}:${privkey}\n`);
                return false; 
            } else {
                console.log(`${prefix} ${chalk.red("Faucet claim failed: " + JSON.stringify(data))}`);
                retry++;
            }
        } catch (e) {
            console.log(`${prefix} ${chalk.red("Faucet request failed: " + e.message)}`);
            retry++;
        }
    }
    fs.appendFileSync(PHAROS_FAILED_FILE, `${acct_addr}:${privkey}\n`);
    return false;
}

// Module 2
async function faucetZenithUSDC(idx, address, privkey, proxy) {
    const client = getAxiosWithProxy(proxy);
    let retry = 0, success = false, prefix = "";
    while (retry < MAX_RETRIES && !success) {
        prefix = chalk.cyan(`${nowStr()} [${idx}] [${chalk.yellow(shortAddr(address))}]`);
        const ip = await getCurrentIp(proxy);
        console.log(`${prefix} USDC faucet [Retry ${retry + 1}/${MAX_RETRIES}] Proxy: ${chalk.green(ip)}`);
        try {
            const payload = { tokenAddress: ZENITH_TOKEN_ADDRESS, userAddress: address };
            const { data } = await client.post(ZENITH_FAUCET_URL, payload, {
                headers: {
                    "Accept": "*/*",
                    "Content-Type": "application/json",
                    "Origin": "https://testnet.zenithswap.xyz",
                    "Referer": "https://testnet.zenithswap.xyz/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
                }
            });
            const status = data?.status, message = data?.message || "";
            if (status === 200 && message === "ok") {
                console.log(`${prefix} ${chalk.green("USDC faucet via Zenithswap successful!")}`);
                fs.appendFileSync(USDC_SUCCESS_FILE, `${address}:${privkey}\n`);
                success = true;
            } else if (message.includes("has already got token today")) {
                console.log(`${prefix} ${chalk.yellow("USDC faucet already claimed today.")}`);
                fs.appendFileSync(USDC_SUCCESS_FILE, `${address}:${privkey}\n`);
                success = true;
            } else {
                console.log(`${prefix} ${chalk.red("USDC faucet failed: " + JSON.stringify(data))}`);
                retry++;
            }
        } catch (e) {
            console.log(`${prefix} ${chalk.red("USDC faucet request error: " + e.message)}`);
            retry++;
        }
    }
    if (!success) {
        fs.appendFileSync(USDC_FAILED_FILE, `${address}:${privkey}\n`);
    }
}

// Module 4: SWAP PHRS -> USDC then USDC -> PHRS
async function withRetries(fn, args, prefix, stepName, maxRetries = 5, delay = 2500) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn(...args);
        } catch (e) {
            lastError = e;
            console.log(chalk.red(`${nowStr()} ${prefix} [${stepName}] Failed attempt ${attempt}/${maxRetries}: ${e.message}`));
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

async function withTimeout(promise, ms, onTimeoutMsg = 'Timeout') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(onTimeoutMsg)), ms))
    ]);
}

function getExactInputSingleData({ tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96 }) {
    return new ethers.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
    ]).encodeFunctionData(
        "exactInputSingle",
        [{
            tokenIn,
            tokenOut,
            fee,
            recipient,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        }]
    );
}

async function approveIfNeeded(tokenContract, owner, spender, amount, prefix, symbol="TOKEN") {
    const allowance = await tokenContract.allowance(owner, spender);
    if (allowance < amount) {
        console.log(chalk.blue(`${nowStr()} ${prefix} Approving ${symbol}...`));
        const approveTx = await tokenContract.approve(spender, amount);
        await approveTx.wait();
        console.log(chalk.green(`${nowStr()} ${prefix} Approved ${symbol} for router`));
    } else {
        console.log(chalk.green(`${nowStr()} ${prefix} ${symbol} already approved for router.`));
    }
}

async function wrapPHRS(wallet, amountWei, prefix) {
    try {
        const wphrs = new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, wallet);
        const tx = await wphrs.deposit({ value: amountWei, gasLimit: 100000 });
        await tx.wait();
        console.log(chalk.green(`${nowStr()} ${prefix} Wrapped ${ethers.formatEther(amountWei)} PHRS to WPHRS`));
        return tx.hash;
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Wrap PHRS→WPHRS failed: ${e.message}`));
        throw e;
    }
}

async function swapWPHRSToUSDC(wallet, amountInWei, prefix) {
    try {
        const router = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);

        const exactInputData = getExactInputSingleData({
            tokenIn: WPHRS_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 500,
            recipient: wallet.address,
            amountIn: amountInWei,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        const deadline = Math.floor(Date.now() / 1000) + 600;

        let gasLimit = 179000;
        try {
            gasLimit = await router.multicall.estimateGas(deadline, [exactInputData]);
            gasLimit = Math.ceil(Number(gasLimit) * 1.05);
        } catch (e) {
            console.log(chalk.yellow(`${nowStr()} ${prefix} Estimate gas failed, set default 179000`));
        }

        const tx = await router.multicall(deadline, [exactInputData], { gasLimit });
        await tx.wait();

        console.log(chalk.green(`${nowStr()} ${prefix} WPHRS→USDC swap TX: ${tx.hash}`));
        return tx.hash;
    } catch (e) {
        // console.log(chalk.red(`${prefix} Swap WPHRS→USDC failed: ${e.message}`));
        console.log(chalk.red(`${nowStr()} ${prefix} Swap WPHRS→USDC failed: Transaction reverted, will retry...`));
        throw e;
    }
}

async function swapUSDCToWPHRS(wallet, usdcAmount, prefix) {
    try {
        const router = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);

        const exactInputData = getExactInputSingleData({
            tokenIn: USDC_ADDRESS,
            tokenOut: WPHRS_ADDRESS,
            fee: 500,
            recipient: wallet.address,
            amountIn: usdcAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        const deadline = Math.floor(Date.now() / 1000) + 600;

        let gasLimit = 179000;
        try {
            gasLimit = await router.multicall.estimateGas(deadline, [exactInputData]);
            gasLimit = Math.ceil(Number(gasLimit) * 1.05); 
        } catch (e) {
            console.log(chalk.yellow(`${nowStr()} ${prefix} Estimate gas failed, set default 179000`));
        }

        const tx = await router.multicall(deadline, [exactInputData], { gasLimit });
        await tx.wait();

        console.log(chalk.green(`${nowStr()} ${prefix} USDC→WPHRS swap TX: ${tx.hash}`));
        return tx.hash;
    } catch (e) {
        // console.log(chalk.red(`${prefix} Swap USDC→WPHRS failed: ${e.message}`));
        console.log(chalk.red(`${nowStr()} ${prefix} Swap USDC→WPHRS failed: Transaction reverted, will retry...`));
        throw e;
    }
}

async function swapModule4(idx, privkey, proxy, minAmount, maxAmount) {
    const provider = getProviderWithProxy(proxy);
    const wallet = new ethers.Wallet(privkey, provider);
    const address = wallet.address;
    const prefix = `[${idx}] [${shortAddr(wallet.address)}]`;

    try {
        const ip = await getCurrentIp(proxy);
        console.log(chalk.yellow(`${nowStr()} ${prefix} Proxy IP: ${ip}`));

        const amountInEth = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(8);
        const amountInWei = ethers.parseEther(amountInEth);

        const nativeBalance = await provider.getBalance(address);
        if (nativeBalance < amountInWei) {
            console.log(chalk.red(`${prefix} Not enough PHRS to wrap.`));
            return;
        }

        await withTimeout(withRetries(wrapPHRS, [wallet, amountInWei, prefix], prefix, "WrapPHRS"), TASK_TIMEOUT, "WrapPHRS timeout");
        const wphrs = new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, wallet);
        await withTimeout(withRetries(approveIfNeeded, [wphrs, address, SWAP_ROUTER_ADDRESS, amountInWei, prefix, "WPHRS"], prefix, "ApproveWPHRS"), TASK_TIMEOUT, "ApproveWPHRS timeout");
        await withTimeout(withRetries(swapWPHRSToUSDC, [wallet, amountInWei, prefix], prefix, "SwapWPHRSUSDC"), TASK_TIMEOUT, "SwapWPHRSUSDC timeout");
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
        let usdcBal = await withTimeout(withRetries(async () => await usdc.balanceOf(address), [], prefix, "CheckUSDCBalance"), TASK_TIMEOUT, "CheckUSDCBalance timeout");
        console.log(chalk.cyan(`${nowStr()} ${prefix} USDC balance after swap: ${ethers.formatUnits(usdcBal, 18)}`));
        await withTimeout(withRetries(approveIfNeeded, [usdc, address, SWAP_ROUTER_ADDRESS, usdcBal, prefix, "USDC"], prefix, "ApproveUSDC"), TASK_TIMEOUT, "ApproveUSDC timeout");
        if (usdcBal > 0n) {
            await withTimeout(withRetries(swapUSDCToWPHRS, [wallet, usdcBal, prefix], prefix, "SwapUSDCWPHRS"), TASK_TIMEOUT, "SwapUSDCWPHRS timeout");
        } else {
            console.log(chalk.red(`${nowStr()} ${prefix} No USDC to swap back.`));
        }
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Swap error: ${e.message}`));
    }
}

// Module 5: Send to friends

// Function: random element from array
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

async function verifySendToFriendTask(address, tx_hash, proxy, jwt, prefix) {
    const client = getAxiosWithProxy(proxy);
    const params = { address, task_id: 103, tx_hash };
    let retry = 0;

    while (retry < 5) {
        try {
            const { data } = await client.post(
                "https://api.pharosnetwork.xyz/task/verify",
                null,
                {
                    params,
                    headers: getHeaders(jwt),
                    timeout: 20000
                }
            );
            const msg = data?.msg || "";
            if (msg === "task verified successfully") {
                console.log(chalk.green(`${nowStr()} ${prefix} [Verify] Task verified successfully!`));
                return true;
            } else {
                console.log(chalk.red(`${nowStr()} ${prefix} [Verify] Failed: ${JSON.stringify(data)}`));
                retry++;
            }
        } catch (e) {
            console.log(chalk.red(`${nowStr()} ${prefix} [Verify] Error: ${e.message}`));
            retry++;
        }
        if (retry < 5) await new Promise(r => setTimeout(r, 2000));
    }
    console.log(chalk.red(`${nowStr()} ${prefix} [Verify] Failed to verify after 5 retries.`));
    return false;
}


// Module 5: Transfer PHRS to a random friend from file
async function transferPHRSToFriend(idx, privkey, proxy, minAmount, maxAmount, walletsToSend) {
    const provider = getProviderWithProxy(proxy);
    const wallet = new ethers.Wallet(privkey, provider);
    const prefix = `[${idx}] [${shortAddr(wallet.address)}]`;

    let jwt = "";
    let acct_addr = wallet.address;

    try {
        const client = getAxiosWithProxy(proxy);
        const { address, signature } = await signMessage(privkey, SIGN_MESSAGE);
        acct_addr = address;

        try {
            const params = { address: acct_addr, signature, invite_code: INVITE_CODE };
            const { data } = await client.post(LOGIN_URL, null, { params, headers: getHeaders('null') });
            jwt = data?.data?.jwt;
            if (!jwt) throw new Error("No jwt returned");
            console.log(`${prefix} ${chalk.green("Login for send-to-friend successful. JWT OK.")}`);
        } catch (e) {
            console.log(`${prefix} ${chalk.red("Login for send-to-friend failed: " + e.message)}`);
            return false;
        }

        const ip = await withTimeout(getCurrentIp(proxy), TASK_TIMEOUT, "GetCurrentIp timeout");
        console.log(chalk.yellow(`${nowStr()} ${prefix} Proxy IP: ${ip}`));
        const toAddress = pickRandom(walletsToSend);

        const amount = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(8);
        const amountWei = ethers.parseEther(amount);

        const nativeBalance = await withTimeout(provider.getBalance(wallet.address), TASK_TIMEOUT, "GetBalance timeout");
        if (nativeBalance < amountWei + ethers.parseEther("0.00002")) { 
            console.log(chalk.red(`${nowStr()} ${prefix} Not enough PHRS to send.`));
            return false;
        }

        const tx = await withTimeout(
            wallet.sendTransaction({
                to: toAddress,
                value: amountWei,
                gasLimit: 21000
            }),
            TASK_TIMEOUT,
            "SendTransaction timeout"
        );
        console.log(chalk.blue(`${nowStr()} ${prefix} Sending ${amount} PHRS to ${toAddress}... TX: ${tx.hash}`));

        await withTimeout(tx.wait(), TASK_TIMEOUT, "TxWait timeout");
        console.log(chalk.green(`${nowStr()} ${prefix} Transfer completed: ${tx.hash}`));

        await verifySendToFriendTask(acct_addr, tx.hash, proxy, jwt, prefix);

    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Transfer failed: ${e.message}`));
        return false;
    }
    return true;
}


function loadWalletsToSend(path) {
    if (!fs.existsSync(path)) {
        console.log(chalk.red(`File ${path} not found!`));
        process.exit(1);
    }
    return fs.readFileSync(path, "utf8")
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
}

// Module 6: Provide LP
async function getTokenDecimals(tokenAddress, provider) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await tokenContract.decimals();
    } catch {
        return 18;
    }
}

async function getTokenBalance(tokenAddress, address, provider) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await tokenContract.balanceOf(address);
    } catch {
        return 0n;
    }
}

async function approveTokenIfNeeded(tokenAddress, spenderAddress, amount, wallet, prefix, symbol="TOKEN") {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, spenderAddress);
    if (allowance >= amount) {
        console.log(chalk.green(`${nowStr()} ${prefix} ${symbol} already approved for router.`));
        return true;
    }
    console.log(chalk.blue(`${nowStr()} ${prefix} Approving ${symbol}...`));
    const tx = await tokenContract.approve(spenderAddress, amount);
    await tx.wait();
    console.log(chalk.green(`${nowStr()} ${prefix} Approved ${symbol} for router`));
    return true;
}

async function getNativeBalance(address, provider) {
    try {
        return await provider.getBalance(address);
    } catch {
        return 0n;
    }
}

async function wrapIfNeeded(wallet, provider, needAmount, prefix) {
    const wphrsBalance = await getTokenBalance(WPHRS_ADDRESS, wallet.address, provider);
    if (wphrsBalance >= needAmount) return true;

    const nativeBalance = await getNativeBalance(wallet.address, provider);
    if (nativeBalance < needAmount) {
        console.log(chalk.red(`${nowStr()} ${prefix} Not enough PHRS to wrap.`));
        return false;
    }

    const wrapAmount = needAmount - wphrsBalance;
    console.log(chalk.blue(`${nowStr()} ${prefix} Wrapping extra PHRS: ${ethers.formatEther(wrapAmount)}...`));
    await withTimeout(withRetries(wrapPHRS, [wallet, wrapAmount, prefix], prefix, "WrapPHRS"), 90000, "WrapPHRS Timeout");
    return true;
}

async function swapIfNeeded(wallet, provider, needAmount, prefix) {
    const usdcBalance = await getTokenBalance(USDC_ADDRESS, wallet.address, provider);
    if (usdcBalance >= needAmount) return true;

    const wphrsBalance = await getTokenBalance(WPHRS_ADDRESS, wallet.address, provider);

    if (wphrsBalance < needAmount) {
        const nativeBalance = await getNativeBalance(wallet.address, provider);
        const wrapAmount = needAmount - wphrsBalance;
        if (nativeBalance < wrapAmount) {
            console.log(chalk.red(`${nowStr()} ${prefix} Not enough PHRS to wrap for USDC swap.`));
            return false;
        }
        await withTimeout(withRetries(wrapPHRS, [wallet, wrapAmount, prefix], prefix, "WrapPHRS(ForUSDC)"), 90000, "WrapPHRS Timeout");
    }

    const wphrs = new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, wallet);
    await withTimeout(withRetries(approveTokenIfNeeded, [WPHRS_ADDRESS, SWAP_ROUTER_ADDRESS, needAmount, wallet, prefix, "WPHRS"], prefix, "ApproveWPHRS"), 90000, "ApproveWPHRS Timeout");
    
    console.log(chalk.blue(`${nowStr()} ${prefix} Swapping WPHRS → USDC for LP... Need: ${ethers.formatUnits(needAmount, 18)} USDC`));
    await withTimeout(withRetries(swapWPHRSToUSDC, [wallet, needAmount, prefix], prefix, "SwapWPHRSUSDC"), 120000, "SwapWPHRSUSDC Timeout");
    return true;
}

async function addLiquidityV3(wallet, provider, amountWPHRS, amountUSDC, prefix) {
    const lpRouter = new ethers.Contract(LP_ROUTER_ADDRESS, LP_ROUTER_ABI, wallet);
    const pool = new ethers.Contract(USDC_POOL_ADDRESS, POOL_ABI, provider);

    const token0 = await pool.token0();
    const token1 = await pool.token1();
    const fee = Number(await pool.fee());

    let [amount0, amount1, symbol0, symbol1] = [amountWPHRS, amountUSDC, "WPHRS", "USDC"];
    if (token0.toLowerCase() !== WPHRS_ADDRESS.toLowerCase()) {
        [amount0, amount1] = [amountUSDC, amountWPHRS];
        [symbol0, symbol1] = ["USDC", "WPHRS"];
    }

    await withTimeout(withRetries(approveTokenIfNeeded, [token0, LP_ROUTER_ADDRESS, amount0, wallet, prefix, symbol0], prefix, "ApproveToken0"), 90000, "ApproveToken0 Timeout");
    await withTimeout(withRetries(approveTokenIfNeeded, [token1, LP_ROUTER_ADDRESS, amount1, wallet, prefix, symbol1], prefix, "ApproveToken1"), 90000, "ApproveToken1 Timeout");

    const tickLower = -887270;
    const tickUpper = 887270;

    // LP Params
    const mintParams = {
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 600
    };

    let gasLimit = 579000n;
    try {
        gasLimit = await lpRouter.mint.estimateGas(mintParams);
        gasLimit = (gasLimit * 120n) / 100n;
    } catch {
        gasLimit = 579000n;
        console.log(chalk.yellow(`${nowStr()} ${prefix} Estimate gas failed, using default.`));
    }

    // Add LP
    const tx = await lpRouter.mint(mintParams, { gasLimit });
    console.log(chalk.blue(`${nowStr()} ${prefix} Minting LP... TX: ${tx.hash}`));
    await tx.wait();
    console.log(chalk.green(`${nowStr()} ${prefix} Add Liquidity SUCCESS: https://pharos-testnet.socialscan.io/tx/${tx.hash}`));
    return tx.hash;
}

async function addLiquidityModule6(idx, privkey, proxy, minAmount, maxAmount) {
    const provider = getProviderWithProxy(proxy);
    const wallet = new ethers.Wallet(privkey, provider);
    const prefix = `[${idx}] [${shortAddr(wallet.address)}]`;

    try {
        const ip = await withTimeout(getCurrentIp(proxy), SAFE_TIMEOUT, "getCurrentIp timeout");
        console.log(chalk.yellow(`${nowStr()} ${prefix} Proxy IP: ${ip}`));

        const wphrsDecimals = await withTimeout(getTokenDecimals(WPHRS_ADDRESS, provider), SAFE_TIMEOUT, "getTokenDecimals timeout (WPHRS)");
        const usdcDecimals = await withTimeout(getTokenDecimals(USDC_ADDRESS, provider), SAFE_TIMEOUT, "getTokenDecimals timeout (USDC)");

        const randomWPHRS = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(8);
        const randomUSDC  = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(8);
        const amountWPHRS = ethers.parseUnits(randomWPHRS, wphrsDecimals);
        const amountUSDC  = ethers.parseUnits(randomUSDC,  usdcDecimals);

        let wphrsBalance = await withTimeout(getTokenBalance(WPHRS_ADDRESS, wallet.address, provider), SAFE_TIMEOUT, "getTokenBalance timeout (WPHRS)");
        let usdcBalance  = await withTimeout(getTokenBalance(USDC_ADDRESS,  wallet.address, provider), SAFE_TIMEOUT, "getTokenBalance timeout (USDC)");

        let okWPHRS = true, okUSDC = true;
        if (wphrsBalance < amountWPHRS) {
            okWPHRS = await withTimeout(wrapIfNeeded(wallet, provider, amountWPHRS, prefix), SAFE_TIMEOUT, "wrapIfNeeded timeout");
        }
        if (usdcBalance < amountUSDC) {
            okUSDC = await withTimeout(swapIfNeeded(wallet, provider, amountUSDC, prefix), SAFE_TIMEOUT, "swapIfNeeded timeout");
        }

        wphrsBalance = await withTimeout(getTokenBalance(WPHRS_ADDRESS, wallet.address, provider), SAFE_TIMEOUT, "getTokenBalance timeout 2 (WPHRS)");
        usdcBalance  = await withTimeout(getTokenBalance(USDC_ADDRESS,  wallet.address, provider), SAFE_TIMEOUT, "getTokenBalance timeout 2 (USDC)");

        if (okWPHRS && okUSDC && wphrsBalance >= amountWPHRS && usdcBalance >= amountUSDC) {
            await withTimeout(
                withRetries(addLiquidityV3, [wallet, provider, amountWPHRS, amountUSDC, prefix], prefix, "AddLiquidity"),
                TX_TIMEOUT,
                "AddLiquidity timeout"
            );
        } else {
            console.log(chalk.red(
                `${nowStr()} ${prefix} Still not enough balance after wrap/swap! `
                + `WPHRS=${ethers.formatUnits(wphrsBalance, wphrsDecimals)} `
                + `USDC=${ethers.formatUnits(usdcBalance, usdcDecimals)}.`
            ));
        }
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Add LP error: ${e.message}`));
    }
}

// Module 7: Run all module 4, 5, 6 with shuffle
function sleepRandom(minSec, maxSec) {
    const sec = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec);
    console.log(chalk.yellow(`[SLEEP] Waiting for ${sec} seconds before next module...`));
    return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

function shuffle(array) {
    // Fisher–Yates shuffle
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function module7AllRandomOrder(idx, priv, proxy, repeat, min_amount, max_amount, walletsToSend) {
    for (let i = 0; i < repeat; i++) {
        let mods = [4, 5, 6];
        shuffle(mods);
        console.log(chalk.magenta(`[${idx}] [Loop ${i+1}/${repeat}] >> Module order: ${mods.join(", ")}`));
        for (let mod of mods) {
            if (mod === 4) {
                console.log(chalk.cyan(`[${idx}] [Loop ${i+1}/${repeat}] >> Running [Module 4] Swap PHRS <-> USDC`));
                await swapModule4(idx, priv, proxy, min_amount, max_amount);
            } else if (mod === 5) {
                console.log(chalk.cyan(`[${idx}] [Loop ${i+1}/${repeat}] >> Running [Module 5] Send PHRS to friend`));
                await transferPHRSToFriend(idx, priv, proxy, min_amount, max_amount, walletsToSend);
            } else if (mod === 6) {
                console.log(chalk.cyan(`[${idx}] [Loop ${i+1}/${repeat}] >> Running [Module 6] Add Liquidity`));
                await addLiquidityModule6(idx, priv, proxy, min_amount, max_amount);
            }
            await sleepRandom(MIN_SLEEP, MAX_SLEEP);
        }
    }
}

async function runModule7ForAllAccounts(privs, proxies, repeat, min_amount, max_amount, walletsToSend) {
    const tasks = privs.map((priv, idx) => {
        const proxy = proxies[idx % proxies.length];
        return limit(() => module7AllRandomOrder(idx + 1, priv, proxy, repeat, min_amount, max_amount, walletsToSend));
    });
    await Promise.all(tasks);
}

// ========== CLI ==========
function menu() {
    console.log(chalk.cyan("\n========= Pharos Network Faucet Menu ========="));
    console.log(chalk.yellow("1. Faucet Pharos and daily checkin"));
    console.log(chalk.yellow("2. Faucet USDC (Zenithswap)"));
    console.log(chalk.yellow("3. Faucet both (Pharos then USDC)"));
    console.log(chalk.yellow("4. Swap tokens on Zenithswap (PHRS <-> USDC)"));
    console.log(chalk.yellow("5. Send PHRS to random friends (from walletsToSend.txt)"));
    console.log(chalk.yellow("6. Add Liquidity (WPHRS/USDC V3)"));
    console.log(chalk.yellow("7. Run All (Swap + Send PHRS + Add LP, random module, sleep between)"));
    console.log(chalk.yellow("0. Exit"));
    console.log(chalk.yellow("More features update soon..."));
    console.log(chalk.cyan("=========================================="));
    while (true) {
        const choice = prompt(chalk.green("Enter your choice (1/2/3/4/5/6/7/0): ")).trim();
        if (["1", "2", "3", "4", "5", "6", "7", "0"].includes(choice)) return choice;
        console.log(chalk.red("Invalid choice! Please enter 1, 2, 3, 4, 5, 6, 7 or 0."));
    }
}

// ========== MAIN ==========
async function main() {
    const privs = loadLines(PRIV_FILE);
    const proxies = loadLines(PROXIES_FILE, {allowNullIfEmpty: true});

    while (true) {
        displayBanner();
        const choice = menu();
        if (choice === "0") {
            console.log(chalk.yellow("Exit. Goodbye!"));
            break;
        }
        if (choice === "1") {
            // Faucet Pharos
            await runParallelWithPLimit(faucetPharos, privs, proxies, 1);
        } else if (choice === "2") {
            // USDC faucet by Zenithswap
            await runParallelWithPLimit(
                async (idx, priv, proxy) => {
                    const address = new ethers.Wallet(priv).address;
                    await faucetZenithUSDC(idx, address, priv, proxy);
                }, privs, proxies, 1
            );
        } else if (choice === "3") {
            // Faucet Pharos + Faucet Zenithswap
            await runParallelWithPLimit(
                async (idx, priv, proxy) => {
                    await faucetPharos(idx, priv, proxy);
                    const address = new ethers.Wallet(priv).address;
                    await faucetZenithUSDC(idx, address, priv, proxy);
                }, privs, proxies, 1
            );
        } else if (choice === "4") {
            // Swap module with repeat n
            const min_amount = parseFloat(prompt("Enter min amount PHRS to swap (e.g., 0.000001): "));
            const max_amount = parseFloat(prompt("Enter max amount PHRS to swap (e.g., 0.000002): "));
            const repeat = Math.max(1, parseInt(prompt("Enter repeat times: "))) || 1;
            await runParallelWithPLimit(swapModule4, privs, proxies, repeat, min_amount, max_amount);
        } else if (choice === "5") {
            const min_amount = parseFloat(prompt("Enter min amount PHRS to send: "));
            const max_amount = parseFloat(prompt("Enter max amount PHRS to send: "));
            const repeat = parseInt(prompt("Enter repeat times: "));
            const walletsToSend = loadWalletsToSend(WALLETS_TO_SEND_FILE);
            await runParallelWithPLimit(
                transferPHRSToFriend,
                privs,
                proxies,
                repeat,
                min_amount,
                max_amount,
                walletsToSend
            );
        } else if (choice === "6") {
            const min_amount = parseFloat(prompt("Enter min amount for WPHRS & USDC to add LP (e.g., 0.000001): "));
            const max_amount = parseFloat(prompt("Enter max amount for WPHRS & USDC to add LP (e.g., 0.000002): "));
            const repeat = parseInt(prompt("Enter repeat times: "));
            await runParallelWithPLimit(addLiquidityModule6, privs, proxies, repeat, min_amount, max_amount);
        } else if (choice === "7") {
            const min_amount = parseFloat(prompt("Enter min amount PHRS: "));
            const max_amount = parseFloat(prompt("Enter max amount PHRS: "));
            const repeat = parseInt(prompt("Enter repeat times: "));
            const walletsToSend = loadWalletsToSend(WALLETS_TO_SEND_FILE);
            await runModule7ForAllAccounts(privs, proxies, repeat, min_amount, max_amount, walletsToSend);
        }
    }
}

main();
