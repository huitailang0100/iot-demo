// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

// 解决ES模块中__dirname的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

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
    if (client.readyState === WebSocket.OPEN) { // 修复：使用 WebSocket.OPEN 替代 ws.OPEN
      client.send(data);
      activeClients++;
    }
  });
  
  console.log(`[SERVER] Broadcasted message to ${activeClients} clients`);
}

// 设置MQTT客户端
const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'iot/demo/temperature';

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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] HTTP server running on http://localhost:${PORT}`);
});