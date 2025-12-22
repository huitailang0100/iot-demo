// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';

// 解决ES模块中__dirname的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// 数据库文件路径
const DB_FILE_PATH = path.join(__dirname, 'warehouse_data.db');

// 初始化数据库
async function initDatabase() {
  // 初始化 SQL.js
  const SQL = await initSqlJs({});
  
  let db;
  
  // 尝试从文件加载现有数据库
  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('[WAREHOUSE-SERVER] Loaded existing database from file');
    } catch (err) {
      console.error('[WAREHOUSE-SERVER] Error loading database from file:', err.message);
      // 如果无法加载现有数据库，则创建一个新的
      db = new SQL.Database();
    }
  } else {
    // 创建新的数据库
    db = new SQL.Database();
    console.log('[WAREHOUSE-SERVER] Created new database');
  }
  
  // 创建表（添加仓储特有字段）
  db.run(`
    CREATE TABLE IF NOT EXISTS warehouse_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      location TEXT,
      timestamp TEXT,
      temperature REAL,
      humidity REAL,
      air_quality REAL,
      light_level INTEGER,
      noise_level REAL
    )
  `);
  
  return db;
}

// 保存数据库到文件
function saveDatabaseToFile(db) {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE_PATH, buffer);
    console.log('[WAREHOUSE-SERVER] Database saved to file');
  } catch (err) {
    console.error('[WAREHOUSE-SERVER] Error saving database to file:', err.message);
  }
}

// 创建HTTP服务器
const server = http.createServer((req, res) => {
  // 处理静态文件请求
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[WAREHOUSE-SERVER] Error reading index.html:', err.message);
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/visualization.html') {
    // 添加对 visualization.html 的支持
    fs.readFile(path.join(__dirname, 'warehouse_visualization.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[WAREHOUSE-SERVER] Error reading warehouse_visualization.html:', err.message);
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/visualization_history.html') {
    fs.readFile(path.join(__dirname, 'warehouse_history.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[WAREHOUSE-SERVER] Error reading warehouse_history.html:', err.message);
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url.startsWith('/api/history')) {
    // 提供历史数据API
    if (!db) {
      res.writeHead(500);
      res.end('Database not available');
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(urlObj.searchParams.get('limit')) || 100;
    const deviceId = urlObj.searchParams.get('deviceId') || null;

    let query = 'SELECT * FROM warehouse_data';
    let params = [];
    
    if (deviceId) {
      query += ' WHERE device_id = ?';
      params.push(deviceId);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    try {
      // 使用 db.exec 执行查询
      const result = db.exec(query, params);
      
      // 转换结果为对象数组
      let rows = [];
      if (result.length > 0) {
        const columns = result[0].columns;
        const values = result[0].values;
        
        rows = values.map(row => {
          const obj = {};
          columns.forEach((col, index) => {
            obj[col] = row[index];
          });
          return obj;
        });
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      console.error('[WAREHOUSE-SERVER] Database query error:', err);
      res.writeHead(500);
      res.end('Database query error');
    }
  } else if (req.url === '/api/control' && req.method === 'POST') {
    // 处理执行器控制请求
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const controlData = JSON.parse(body);
        // 发送控制命令到MQTT
        if (mqttClient && mqttClient.connected) {
          const controlTopic = 'warehouse/control';
          mqttClient.publish(controlTopic, JSON.stringify(controlData), { qos: 1 });
          console.log('[WAREHOUSE-SERVER] Sent control command:', controlData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Control command sent' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'MQTT client not connected' }));
        }
      } catch (err) {
        console.error('[WAREHOUSE-SERVER] Error processing control command:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid request data' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// 创建WebSocket服务器
const wss = new WebSocketServer({ server });

// 存储客户端连接
const clients = new Set();

let messageCounter = 0;

// 处理WebSocket连接
wss.on('connection', (ws, req) => {
  console.log(`[WAREHOUSE-SERVER] New client connected. IP: ${req.socket.remoteAddress}`);
  clients.add(ws);
  
  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to Warehouse Environment Monitoring Server',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('close', () => {
    console.log('[WAREHOUSE-SERVER] Client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('[WAREHOUSE-SERVER] WebSocket error:', error);
    clients.delete(ws);
  });
});

// 广播消息给所有连接的客户端
function broadcastMessage(message) {
  messageCounter++;
  const data = JSON.stringify({
    type: 'mqtt_data',
    payload: message,
    timestamp: new Date().toISOString(),
    counter: messageCounter
  });
  
  let activeClients = 0;
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      activeClients++;
    }
  });
  
  console.log(`[WAREHOUSE-SERVER] Broadcasted message to ${activeClients} clients`);
}

// 设置MQTT客户端
const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'warehouse/env/monitor';

// 初始化数据库
let db;
initDatabase().then(database => {
  db = database;
  console.log('[WAREHOUSE-SERVER] Database initialized');
}).catch(err => {
  console.error('[WAREHOUSE-SERVER] Database initialization error:', err);
});

console.log(`[WAREHOUSE-SERVER] Connecting to MQTT broker: ${mqttUrl}`);
const mqttClient = mqtt.connect(mqttUrl, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: 'warehouse-gateway-' + Math.random().toString(16).substr(2, 8),
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
});

// MQTT连接成功
mqttClient.on('connect', () => {
  console.log('[WAREHOUSE-SERVER] Successfully connected to MQTT broker:', mqttUrl);
  mqttClient.subscribe(topic, { qos: 0 }, (err) => {
    if (err) {
      console.error('[WAREHOUSE-SERVER] Subscribe error:', err.message);
    } else {
      console.log(`[WAREHOUSE-SERVER] Successfully subscribed to topic: ${topic}`);
    }
  });
  
  // 订阅控制命令确认主题
  mqttClient.subscribe('warehouse/control/confirm', { qos: 1 }, (err) => {
    if (err) {
      console.error('[WAREHOUSE-SERVER] Subscribe error:', err.message);
    } else {
      console.log(`[WAREHOUSE-SERVER] Successfully subscribed to control confirm topic`);
    }
  });
});

// 接收MQTT消息
mqttClient.on('message', (receivedTopic, message) => {
  if (receivedTopic === topic) {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[WAREHOUSE-SERVER] Received MQTT message:', JSON.stringify(payload, null, 2));
      broadcastMessage(payload);
      
      // 保存到数据库
      if (db) {
        db.run(
          'INSERT INTO warehouse_data (device_id, location, timestamp, temperature, humidity, air_quality, light_level, noise_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            payload.deviceId || null,
            payload.location || null,
            new Date(payload.ts).toISOString(),
            parseFloat(payload.temperature) || null,
            parseFloat(payload.humidity) || null,
            parseFloat(payload.airQuality) || null,
            parseInt(payload.lightLevel) || null,
            parseFloat(payload.noiseLevel) || null
          ]
        );
        
        // 定期保存数据库到文件
        if (messageCounter % 10 === 0) {
          saveDatabaseToFile(db);
        }
        
        // 检查是否需要触发自动化控制
        checkAutomationRules(payload);
      }
    } catch (e) {
      console.error('[WAREHOUSE-SERVER] Error parsing MQTT message:', e.message);
      console.log('[WAREHOUSE-SERVER] Raw message:', message.toString());
      broadcastMessage(message.toString());
    }
  } else if (receivedTopic === 'warehouse/control/confirm') {
    // 处理执行器确认消息
    try {
      const confirmData = JSON.parse(message.toString());
      console.log('[WAREHOUSE-SERVER] Received control confirmation:', confirmData);
      
      // 广播确认消息给所有客户端
      const confirmMsg = JSON.stringify({
        type: 'control_confirm',
        payload: confirmData,
        timestamp: new Date().toISOString()
      });
      
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(confirmMsg);
        }
      });
    } catch (e) {
      console.error('[WAREHOUSE-SERVER] Error parsing control confirmation:', e.message);
    }
  }
});

// 自动化控制逻辑
function checkAutomationRules(data) {
  const temperature = parseFloat(data.temperature);
  const humidity = parseFloat(data.humidity);
  const airQuality = parseFloat(data.airQuality);
  
  // 温度控制规则
  if (temperature > 30) {
    // 温度过高，启动空调制冷
    sendControlCommand({
      deviceId: 'ac-cooling-system',
      action: 'start',
      parameter: 'cooling',
      reason: 'high_temperature'
    });
  } else if (temperature < 18) {
    // 温度过低，启动空调制热
    sendControlCommand({
      deviceId: 'ac-heating-system',
      action: 'start',
      parameter: 'heating',
      reason: 'low_temperature'
    });
  }
  
  // 湿度控制规则
  if (humidity > 70) {
    // 湿度过高，启动除湿器
    sendControlCommand({
      deviceId: 'dehumidifier-system',
      action: 'start',
      parameter: 'dehumidifying',
      reason: 'high_humidity'
    });
  } else if (humidity < 40) {
    // 湿度过低，启动加湿器
    sendControlCommand({
      deviceId: 'humidifier-system',
      action: 'start',
      parameter: 'humidifying',
      reason: 'low_humidity'
    });
  }
  
  // 空气质量控制规则
  if (airQuality < 50) {
    // 空气质量差，启动空气净化器
    sendControlCommand({
      deviceId: 'air-purifier-system',
      action: 'start',
      parameter: 'purifying',
      reason: 'poor_air_quality'
    });
  }
  
  // 报警规则
  if (temperature > 35 || temperature < 15 || humidity > 80 || humidity < 30 || airQuality < 30) {
    // 环境异常，触发报警器
    sendControlCommand({
      deviceId: 'alarm-system',
      action: 'alert',
      parameter: 'environmental_hazard',
      reason: 'critical_conditions'
    });
  }
}

// 发送控制命令到MQTT
function sendControlCommand(command) {
  if (mqttClient && mqttClient.connected) {
    const controlTopic = 'warehouse/control';
    mqttClient.publish(controlTopic, JSON.stringify(command), { qos: 1 });
    console.log('[WAREHOUSE-SERVER] Sent automated control command:', command);
  }
}

// MQTT错误处理
mqttClient.on('error', (err) => {
  console.error('[WAREHOUSE-SERVER] MQTT Error:', err.message);
});

// MQTT重连事件
mqttClient.on('reconnect', () => {
  console.log('[WAREHOUSE-SERVER] MQTT reconnecting...');
});

// MQTT关闭事件
mqttClient.on('close', () => {
  console.log('[WAREHOUSE-SERVER] MQTT connection closed');
  // 连接关闭时保存数据库
  if (db) {
    saveDatabaseToFile(db);
  }
});

// 服务器关闭时保存数据库
process.on('SIGINT', () => {
  console.log('[WAREHOUSE-SERVER] Shutting down server...');
  if (db) {
    saveDatabaseToFile(db);
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[WAREHOUSE-SERVER] HTTP server running on http://localhost:${PORT}`);
});