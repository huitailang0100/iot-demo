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
const DB_FILE_PATH = path.join(__dirname, 'iot_data.db');

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
      console.log('[SERVER] Loaded existing database from file');
    } catch (err) {
      console.error('[SERVER] Error loading database from file:', err.message);
      // 如果无法加载现有数据库，则创建一个新的
      db = new SQL.Database();
    }
  } else {
    // 创建新的数据库
    db = new SQL.Database();
    console.log('[SERVER] Created new database');
  }
  
  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      timestamp TEXT,
      temperature REAL,
      humidity REAL
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
    console.log('[SERVER] Database saved to file');
  } catch (err) {
    console.error('[SERVER] Error saving database to file:', err.message);
  }
}

// 创建HTTP服务器
const server = http.createServer((req, res) => {
  // 处理静态文件请求
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[SERVER] Error reading index.html:', err.message);
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/visualization.html') {
    // 添加对 visualization.html 的支持
    fs.readFile(path.join(__dirname, 'visualization.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[SERVER] Error reading visualization.html:', err.message);
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/visualization_history.html') {
    fs.readFile(path.join(__dirname, 'visualization_history.html'), 'utf8', (err, data) => {
      if (err) {
        console.error('[SERVER] Error reading visualization_history.html:', err.message);
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

    let query = 'SELECT * FROM sensor_data';
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
      console.error('[SERVER] Database query error:', err);
      res.writeHead(500);
      res.end('Database query error');
    }
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
  console.log(`[SERVER] New client connected. IP: ${req.socket.remoteAddress}`);
  clients.add(ws);
  
  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to MQTT data display server',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('close', () => {
    console.log('[SERVER] Client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('[SERVER] WebSocket error:', error);
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
  
  console.log(`[SERVER] Broadcasted message to ${activeClients} clients`);
}

// 设置MQTT客户端
const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'iot/demo/temperature';

// 初始化数据库
let db;
initDatabase().then(database => {
  db = database;
  console.log('[SERVER] Database initialized');
}).catch(err => {
  console.error('[SERVER] Database initialization error:', err);
});

console.log(`[SERVER] Connecting to MQTT broker: ${mqttUrl}`);
const mqttClient = mqtt.connect(mqttUrl, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: 'mqtt-web-gateway-' + Math.random().toString(16).substr(2, 8),
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
});

// MQTT连接成功
mqttClient.on('connect', () => {
  console.log('[SERVER] Successfully connected to MQTT broker:', mqttUrl);
  mqttClient.subscribe(topic, { qos: 0 }, (err) => {
    if (err) {
      console.error('[SERVER] Subscribe error:', err.message);
    } else {
      console.log(`[SERVER] Successfully subscribed to topic: ${topic}`);
    }
  });
});

// 接收MQTT消息
mqttClient.on('message', (receivedTopic, message) => {
  if (receivedTopic === topic) {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[SERVER] Received MQTT message:', JSON.stringify(payload, null, 2));
      broadcastMessage(payload);
      
      // 保存到数据库
      if (db) {
        db.run(
          'INSERT INTO sensor_data (device_id, timestamp, temperature, humidity) VALUES (?, ?, ?, ?)',
          [
            payload.deviceId || null,
            new Date(payload.ts).toISOString(),
            parseFloat(payload.temperature) || null,
            parseFloat(payload.humidity) || null
          ]
        );
        
        // 定期保存数据库到文件
        if (messageCounter % 10 === 0) {
          saveDatabaseToFile(db);
        }
      }
    } catch (e) {
      console.error('[SERVER] Error parsing MQTT message:', e.message);
      console.log('[SERVER] Raw message:', message.toString());
      broadcastMessage(message.toString());
    }
  }
});

// MQTT错误处理
mqttClient.on('error', (err) => {
  console.error('[SERVER] MQTT Error:', err.message);
});

// MQTT重连事件
mqttClient.on('reconnect', () => {
  console.log('[SERVER] MQTT reconnecting...');
});

// MQTT关闭事件
mqttClient.on('close', () => {
  console.log('[SERVER] MQTT connection closed');
  // 连接关闭时保存数据库
  if (db) {
    saveDatabaseToFile(db);
  }
});

// 服务器关闭时保存数据库
process.on('SIGINT', () => {
  console.log('[SERVER] Shutting down server...');
  if (db) {
    saveDatabaseToFile(db);
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] HTTP server running on http://localhost:${PORT}`);
});