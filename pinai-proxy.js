const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const { DateTime } = require("luxon");
const { HttpsProxyAgent } = require("https-proxy-agent");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { sleep, loadData, getRandomNumber } = require("./utils");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");

class Pinai {
  constructor(queryId, accountIndex, proxy, baseURL, tokens) {
    this.headers = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://web.pinai.tech",
      Referer: "https://web.pinai.tech/",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
      Lang: "vi",
    };
    this.tokenFilePath = path.join(__dirname, "token.json");
    this.baseURL = baseURL;
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.skipTasks = settings.SKIP_TASKS;
    this.tokens = tokens || {};
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    const telegramauth = this.queryId;
    const userData = JSON.parse(decodeURIComponent(telegramauth.split("user=")[1].split("&")[0]));
    this.session_name = userData.id;
    this.#get_user_agent();
  }

  loadProxies() {
    try {
      const proxyFile = path.join(__dirname, "proxy.txt");
      return fs.readFileSync(proxyFile, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
    } catch (error) {
      this.log(`Lỗi khi đọc file proxy: ${error.message}`, "error");
      return [];
    }
  }

  async checkProxyIP(proxy) {
    try {
      const proxyAgent = new HttpsProxyAgent(proxy);
      const response = await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: proxyAgent,
        timeout: 10000,
      });
      if (response.status === 200) {
        return response.data.ip;
      } else {
        throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
    }
  }

  createAxiosInstance(proxy) {
    const proxyAgent = new HttpsProxyAgent(proxy);
    return axios.create({
      httpsAgent: proxyAgent,
      timeout: 30000,
      headers: this.headers,
    });
  }

  log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
      case "success":
        console.log(`[${timestamp}][Account ${this.accountIndex + 1}][${this.proxyIP}] [*] ${msg}`.green);
        break;
      case "custom":
        console.log(`[${timestamp}][Account ${this.accountIndex + 1}][${this.proxyIP}] [*] ${msg}`.magenta);
        break;
      case "error":
        console.log(`[${timestamp}][Account ${this.accountIndex + 1}][${this.proxyIP}] [!] ${msg}`.red);
        break;
      case "warning":
        console.log(`[${timestamp}][Account ${this.accountIndex + 1}][${this.proxyIP}] [*] ${msg}`.yellow);
        break;
      default:
        console.log(`[${timestamp}][Account ${this.accountIndex + 1}][${this.proxyIP}] [*] ${msg}`.blue);
    }
  }

  async countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
      const timestamp = new Date().toLocaleTimeString();
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }

  isExpired(token) {
    const [header, payload, sign] = token.split(".");
    const decodedPayload = Buffer.from(payload, "base64").toString();

    try {
      const parsedPayload = JSON.parse(decodedPayload);
      const now = Math.floor(DateTime.now().toSeconds());

      if (parsedPayload.exp) {
        const expirationDate = DateTime.fromSeconds(parsedPayload.exp).toLocal();
        this.log(`Token hết hạn vào: ${expirationDate.toFormat("yyyy-MM-dd HH:mm:ss")}`.cyan);

        const isExpired = now > parsedPayload.exp;
        this.log(`Token đã hết hạn chưa? ${isExpired ? "Đúng rồi bạn cần thay token" : "Chưa..chạy tẹt ga đi"}`.cyan);

        return isExpired;
      } else {
        this.log(`Token vĩnh cửu không đọc được thời gian hết hạn`.yellow);
        return false;
      }
    } catch (error) {
      this.log(`Lỗi khi kiểm tra token: ${error.message}`.red, "error");
      return true;
    }
  }

  async loginToPinaiAPI(initData) {
    const url = `${this.baseURL}/passport/login/telegram`;
    const payload = {
      invite_code: "p5SeaMr",
      init_data: initData,
    };

    try {
      const axiosInstance = this.createAxiosInstance(this.proxy);
      const response = await axiosInstance.post(url, payload);
      if (response.status === 200) {
        const { access_token } = response.data;
        this.log(`Đăng nhập thành công, lưu token...`, "success");
        return access_token;
      } else {
        this.log(`Đăng nhập thất bại: ${response.data.msg}`, "error");
        return null;
      }
    } catch (error) {
      this.log(`Lỗi khi gọi API: ${error.message}`, "error");
      return null;
    }
  }

  saveAccessToken(userId, token) {
    try {
      this.tokens[userId] = token;
      fs.writeFileSync(this.tokenFilePath, JSON.stringify(this.tokens, null, 2));
      this.log(`Token saved for user ${userId}`, "success");
    } catch (error) {
      this.log(`Error saving token: ${error.message}`, "error");
    }
  }

  async getHomeData(token, proxy) {
    const url = `${this.baseURL}/home`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.get(url);
      if (response.status === 200) {
        const { pin_points, coins, current_model, data_power } = response.data;

        this.log(`Model hiện tại: ${current_model.name}`, "custom");
        this.log(`Level hiện tại: ${current_model.current_level}`, "custom");
        this.log(`Data Power: ${data_power}`, "custom");
        this.log(`Balance: ${pin_points}`, "success");

        const coinToCollect = coins.find((c) => c.type === "Telegram");
        if (coinToCollect && coinToCollect.count > 0) {
          await this.collectCoins(token, coinToCollect, proxy);
        }

        if (settings.AUTO_UPGRADE) {
          await this.checkAndUpgradeModel(token, pin_points, current_model.current_level, proxy);
        }
      }
    } catch (error) {
      this.log(`Lỗi khi gọi API home: ${error.message}`, "error");
    }
  }

  async checkAndUpgradeModel(token, currentPoints, currentLevel, proxy) {
    const url = `${this.baseURL}/model/list`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.get(url);
      if (response.status === 200) {
        const { cost_config } = response.data;

        const nextLevelCost = cost_config.find((config) => config.level === currentLevel + 1);

        if (nextLevelCost) {
          const numericPoints = this.parsePoints(currentPoints);

          if (numericPoints >= nextLevelCost.cost) {
            await this.upgradeModel(token, currentLevel + 1, proxy);
          } else {
            this.log(`Số dư không đủ để nâng cấp lên level ${currentLevel + 1}. Cần thêm ${nextLevelCost.cost_display} points`, "warning");
          }
        }
      }
    } catch (error) {
      this.log(`Lỗi khi kiểm tra khả năng nâng cấp: ${error.message}`, "error");
    }
  }

  parsePoints(points) {
    if (typeof points === "number") return points;

    const multipliers = {
      K: 1000,
      M: 1000000,
    };

    let numericValue = points.replace(/[,]/g, "");

    for (const [suffix, multiplier] of Object.entries(multipliers)) {
      if (points.includes(suffix)) {
        numericValue = parseFloat(points.replace(suffix, "")) * multiplier;
        break;
      }
    }

    return parseFloat(numericValue);
  }

  async upgradeModel(token, newLevel, proxy) {
    const url = `${this.baseURL}/model/upgrade`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.post(url, {});
      if (response.status === 200) {
        this.log(`Nâng cấp model thành công lên level ${newLevel}`, "success");
      }
    } catch (error) {
      this.log(`Lỗi khi nâng cấp model: ${error.message}`, "error");
    }
  }

  async collectCoins(token, coin, proxy) {
    const url = `${this.baseURL}/home/collect`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    const payload = [{ type: coin.type, count: coin.count }];

    try {
      while (coin.count > 0) {
        await sleep(2);
        const response = await axiosInstance.post(url, payload);
        if (response.status === 200) {
          coin.count = response.data.coins.find((c) => c.type === "Telegram").count;
          this.log(`Thu thập thành công, còn lại: ${coin.count}`, "success");

          if (coin.count === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          this.log(`Lỗi khi thu thập coins: ${response.statusText}`, "error");
          break;
        }
      }
      this.log("Đã thu thập hết coins.", "success");
    } catch (error) {
      this.log(`Lỗi khi gọi API collect: ${error.message}`, "error");
    }
  }

  async getTasks(token, proxy) {
    const url = `${this.baseURL}/task/v4/list`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.get(url);
      if (response.status === 200) {
        let { tasks } = response.data;
        tasks = tasks.filter((t) => !settings.SKIP_TASKS.includes(t.task_id) && !t.is_complete);
        for (const task of tasks) {
          await sleep(2);
          if (task.can_claim) {
            await this.claimTask(token, task.task_id, `Claim nhiệm vụ ${task.task_id} | ${task.task_name} thành công`, proxy);
          } else if (task.task_id === 1001 && task.checkin_detail.is_today_checkin === 0) {
            await this.completeTask(token, task.task_id, "Điểm danh hàng ngày thành công", proxy);
          } else if (task.task_id !== 1001) {
            await this.completeTask(token, task.task_id, `Làm nhiệm vụ ${task.task_id} | ${task.task_name} thành công | Phần thưởng: ${task.reward_points}`, proxy);
          }
        }
      }
    } catch (error) {
      this.log(`Lỗi khi gọi API task list: ${error.message}`, "error");
    }
  }

  async completeTask(token, taskId, successMessage, proxy) {
    const url = `${this.baseURL}/task/${taskId}/v2/complete`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.post(url, {});
      if (response.status === 200 && response.data.status === "success") {
        this.log(successMessage, "success");
      } else {
        this.log(`Không thể hoàn thành nhiệm vụ ${taskId}: ${response.statusText}`, "error");
      }
    } catch (error) {
      this.log(`Lỗi khi gọi API complete task ${taskId}: ${error.message}`, "error");
    }
  }
  async claimTask(token, taskId, successMessage, proxy) {
    const url = `${this.baseURL}/task/${taskId}/claim`;
    const axiosInstance = this.createAxiosInstance(proxy);
    axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    try {
      const response = await axiosInstance.post(url, {});
      if (response.status === 200 && response.data.status === "success") {
        this.log(successMessage, "success");
      } else {
        this.log(`Không thể claim nhiệm vụ ${taskId}: ${response.statusText}`, "error");
      }
    } catch (error) {
      this.log(`Lỗi khi gọi API claim task ${taskId}: ${error.message}`, "error");
    }
  }

  async getValidToken(userId, initData) {
    const existingToken = this.tokens[userId];

    if (existingToken && !this.isTokenExpired(existingToken)) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("Token not found or expired, logging in...", "warning");
    const newToken = await this.loginToPinaiAPI(initData);
    if (newToken) {
      this.saveAccessToken(userId, newToken);
      return newToken;
    }

    throw new Error(`No valid token found!`);
  }

  isTokenExpired(token) {
    if (!token) return true;

    try {
      const [, payload] = token.split(".");
      if (!payload) return true;

      const decodedPayload = JSON.parse(Buffer.from(payload, "base64").toString());
      const now = Math.floor(Date.now() / 1000);

      if (!decodedPayload.exp) {
        this.log("Eternal token", "warning");
        return false;
      }

      const expirationDate = new Date(decodedPayload.exp * 1000);
      const isExpired = now > decodedPayload.exp;

      this.log(`Token expires after: ${expirationDate.toLocaleString()}`, "custom");
      this.log(`Token status: ${isExpired ? "Expired" : "Valid"}`, isExpired ? "warning" : "success");

      return isExpired;
    } catch (error) {
      this.log(`Error checking token: ${error.message}`, "error");
      return true;
    }
  }

  async runAccount() {
    const initData = this.queryId;
    const userData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
    const userId = userData.id;
    const firstName = userData.first_name;
    this.session_name = userId;
    const proxy = this.proxy;

    let proxyIP = "Unknown";
    try {
      proxyIP = await this.checkProxyIP(proxy);
      this.proxyIP = proxyIP;
    } catch (error) {
      this.log(`Lỗi kiểm tra IP proxy: ${error.message}`, "warning");
      return;
    }

    const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
    console.log(`=========Tài khoản ${this.accountIndex + 1} | ${firstName}|[${proxyIP}] | Nghỉ ${timesleep} trước khi bắt đầu=============`.green);
    this.#set_headers();
    await sleep(timesleep);
    const token = await this.getValidToken(userId, initData);

    await this.getHomeData(token, proxy);
    await sleep(3);

    if (settings.AUTO_TASK) {
      await this.getTasks(token, proxy);
    }

    await sleep(3);
  }
}

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy, hasIDAPI, tokens } = workerData;
  const to = new Pinai(queryId, accountIndex, proxy, hasIDAPI, tokens);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");
  const tokens = require("./token.json");
  // const agents = #load_session_data();
  // const wallets = loadData("wallets.txt");

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/AirdropScript6)".yellow);
  let maxThreads = settings.MAX_THEADS;

  const { endpoint: hasIDAPI, message } = await checkBaseUrl();
  if (!hasIDAPI) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  queryIds.map((val, i) => new Pinai(val, i, proxies[i], hasIDAPI, {}).createUserAgent());

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI,
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
            tokens,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (message.error) {
                console.log(`Tài khoản ${currentIndex + 1}: ${message.error}`);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex + 1}: ${error.message}`);
              worker.terminate();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex + 1} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    const to = new Pinai(null, 0, proxies[0]);
    await sleep(3);
    console.log("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/AirdropScript6)".yellow);
    console.log(`=============Hoàn thành tất cả tài khoản=============`.magenta);
    await to.countdown(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
