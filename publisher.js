import dotenv from 'dotenv';
dotenv.config();

import mqtt from 'mqtt';

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'warehouse/env/monitor';

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});

client.on('connect', () => {
  console.log('[WAREHOUSE-PUB] Connected:', url);

  // 模拟仓储环境传感器上报数据
  setInterval(() => {
    // 模拟多个仓储区域的传感器数据
    const warehouseZones = ['Zone-A', 'Zone-B', 'Zone-C', 'Zone-D'];
    const zone = warehouseZones[Math.floor(Math.random() * warehouseZones.length)];
    
    const data = {
      deviceId: `sensor-${zone}`,
      ts: Date.now(),
      temperature: (15 + Math.random() * 15).toFixed(2), // 仓库温度范围 15-30°C
      humidity: (40 + Math.random() * 30).toFixed(2),    // 仓库湿度范围 40-70%
      location: zone,
      // 添加仓储特有数据
      airQuality: (80 + Math.random() * 20).toFixed(2),  // 空气质量指数
      lightLevel: Math.floor(Math.random() * 1000),      // 光照强度(lux)
      noiseLevel: (30 + Math.random() * 40).toFixed(2)   // 噪音水平(dB)
    };
    const payload = JSON.stringify(data);
    client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error('[WAREHOUSE-PUB] Publish error:', err.message);
      } else {
        console.log('[WAREHOUSE-PUB] Sent:', payload);
      }
    });
  }, 3000); // 每3秒发送一次数据
});

client.on('error', (err) => console.error('[WAREHOUSE-PUB] Error:', err.message));