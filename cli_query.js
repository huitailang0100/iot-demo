/**
 * IoT历史数据查询CLI工具
 * 提供命令行界面来查询存储在SQLite数据库中的IoT传感器历史数据
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

// 解决ES模块中__dirname的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const DB_FILE_PATH = path.join(__dirname, 'iot_data.db');

// 帮助信息
const helpText = `
IoT历史数据查询工具

用法:
  node cli-query.js [选项]

选项:
  -h, --help              显示帮助信息
  -l, --limit <数量>      限制返回记录数量 (默认: 10)
  -d, --device <设备ID>   筛选特定设备的数据
  -f, --format <格式>     输出格式: table|json|csv (默认: table)
  -s, --sort <排序>       排序方式: asc|desc (默认: desc)
  --min-temp <温度>       筛选最低温度
  --max-temp <温度>       筛选最高温度
  --min-humidity <湿度>   筛选最低湿度
  --max-humidity <湿度>   筛选最高湿度
  --export <文件名>       导出数据到CSV文件

示例:
  node cli-query.js
  node cli-query.js -l 20 -d sensor-001
  node cli-query.js -f json --limit 5
  node cli-query.js --export data.csv
`;

// 默认参数
const defaultOptions = {
  limit: 10,
  format: 'table',
  sort: 'desc'
};

// 解析命令行参数
function parseArgs(args) {
  const options = { ...defaultOptions };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-h':
      case '--help':
        console.log(helpText);
        process.exit(0);
        break;
        
      case '-l':
      case '--limit':
        options.limit = parseInt(args[++i]) || defaultOptions.limit;
        break;
        
      case '-d':
      case '--device':
        options.deviceId = args[++i];
        break;
        
      case '-f':
      case '--format':
        options.format = args[++i];
        break;
        
      case '-s':
      case '--sort':
        options.sort = args[++i];
        break;
        
      case '--min-temp':
        options.minTemp = parseFloat(args[++i]);
        break;
        
      case '--max-temp':
        options.maxTemp = parseFloat(args[++i]);
        break;
        
      case '--min-humidity':
        options.minHumidity = parseFloat(args[++i]);
        break;
        
      case '--max-humidity':
        options.maxHumidity = parseFloat(args[++i]);
        break;
        
      case '--export':
        options.export = args[++i];
        options.format = 'csv';
        break;
    }
  }
  
  return options;
}

// 初始化数据库
async function initDatabase() {
  try {
    // 初始化 SQL.js
    const SQL = await initSqlJs({});
    
    // 检查数据库文件是否存在
    if (!fs.existsSync(DB_FILE_PATH)) {
      console.error('错误: 数据库文件不存在');
      console.error('请确保服务器已运行并生成了数据');
      process.exit(1);
    }
    
    // 从文件加载数据库
    const fileBuffer = fs.readFileSync(DB_FILE_PATH);
    const db = new SQL.Database(fileBuffer);
    
    return db;
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
    process.exit(1);
  }
}

// 构建查询语句
function buildQuery(options) {
  let query = 'SELECT * FROM sensor_data';
  const params = [];
  
  // 构建WHERE条件
  const conditions = [];
  
  if (options.deviceId) {
    conditions.push('device_id = ?');
    params.push(options.deviceId);
  }
  
  if (options.minTemp !== undefined) {
    conditions.push('temperature >= ?');
    params.push(options.minTemp);
  }
  
  if (options.maxTemp !== undefined) {
    conditions.push('temperature <= ?');
    params.push(options.maxTemp);
  }
  
  if (options.minHumidity !== undefined) {
    conditions.push('humidity >= ?');
    params.push(options.minHumidity);
  }
  
  if (options.maxHumidity !== undefined) {
    conditions.push('humidity <= ?');
    params.push(options.maxHumidity);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  // 添加排序和限制
  query += ` ORDER BY timestamp ${options.sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`;
  params.push(options.limit);
  
  return { query, params };
}

// 执行查询
function executeQuery(db, query, params) {
  try {
    const result = db.exec(query, params);
    
    if (result.length === 0) {
      return [];
    }
    
    const columns = result[0].columns;
    const values = result[0].values;
    
    return values.map(row => {
      const obj = {};
      columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return obj;
    });
  } catch (err) {
    throw new Error(`查询执行失败: ${err.message}`);
  }
}

// 格式化输出为表格
function formatAsTable(data) {
  if (data.length === 0) {
    console.log('没有找到数据');
    return;
  }
  
  // 计算列宽
  const headers = Object.keys(data[0]);
  const colWidths = headers.map(header => {
    const maxWidth = Math.max(
      header.length,
      ...data.map(row => String(row[header] || 'N/A').length)
    );
    return Math.min(maxWidth, 25); // 限制最大宽度
  });
  
  // 打印表头
  let headerRow = '|';
  headers.forEach((header, i) => {
    headerRow += ` ${header.padEnd(colWidths[i])} |`;
  });
  console.log(headerRow);
  
  // 打印分隔线
  let separator = '|';
  colWidths.forEach(width => {
    separator += '-'.repeat(width + 2) + '|';
  });
  console.log(separator);
  
  // 打印数据行
  data.forEach(row => {
    let dataRow = '|';
    headers.forEach((header, i) => {
      const value = row[header] !== null ? String(row[header]) : 'N/A';
      // 截断过长的值
      const truncatedValue = value.length > colWidths[i] 
        ? value.substring(0, colWidths[i] - 3) + '...' 
        : value;
      dataRow += ` ${truncatedValue.padEnd(colWidths[i])} |`;
    });
    console.log(dataRow);
  });
}

// 格式化输出为JSON
function formatAsJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

// 格式化输出为CSV
function formatAsCsv(data) {
  if (data.length === 0) {
    console.log('');
    return;
  }
  
  const headers = Object.keys(data[0]);
  
  // 打印表头
  console.log(headers.join(','));
  
  // 打印数据行
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header] !== null ? String(row[header]) : '';
      // 转义包含逗号或引号的值
      if (value.includes(',') || value.includes('"')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    console.log(values.join(','));
  });
}

// 导出到CSV文件
function exportToCsvFile(data, filename) {
  try {
    let csvContent = '';
    
    if (data.length === 0) {
      fs.writeFileSync(filename, csvContent, 'utf8');
      console.log(`数据已导出到 ${filename} (空文件)`);
      return;
    }
    
    const headers = Object.keys(data[0]);
    
    // 添加BOM以支持中文
    csvContent += '\uFEFF';
    
    // 添加表头
    csvContent += headers.join(',') + '\n';
    
    // 添加数据行
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] !== null ? String(row[header]) : '';
        // 转义包含逗号或引号的值
        if (value.includes(',') || value.includes('"')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvContent += values.join(',') + '\n';
    });
    
    fs.writeFileSync(filename, csvContent, 'utf8');
    console.log(`数据已导出到 ${filename}`);
  } catch (err) {
    console.error(`导出失败: ${err.message}`);
  }
}

// 显示统计信息
function showStats(data) {
  if (data.length === 0) {
    console.log('\n统计信息: 无数据');
    return;
  }
  
  // 计算温度统计
  const temperatures = data
    .map(row => row.temperature)
    .filter(temp => temp !== null)
    .map(temp => parseFloat(temp));
    
  // 计算湿度统计
  const humidities = data
    .map(row => row.humidity)
    .filter(hum => hum !== null)
    .map(hum => parseFloat(hum));
    
  console.log('\n统计信息:');
  
  if (temperatures.length > 0) {
    const minTemp = Math.min(...temperatures);
    const maxTemp = Math.max(...temperatures);
    const avgTemp = temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length;
    
    console.log(`  温度 - 最低: ${minTemp.toFixed(2)}°C, 最高: ${maxTemp.toFixed(2)}°C, 平均: ${avgTemp.toFixed(2)}°C`);
  }
  
  if (humidities.length > 0) {
    const minHum = Math.min(...humidities);
    const maxHum = Math.max(...humidities);
    const avgHum = humidities.reduce((sum, hum) => sum + hum, 0) / humidities.length;
    
    console.log(`  湿度 - 最低: ${minHum.toFixed(2)}%, 最高: ${maxHum.toFixed(2)}%, 平均: ${avgHum.toFixed(2)}%`);
  }
  
  console.log(`  总记录数: ${data.length}`);
}

// 主函数
async function main() {
  try {
    // 解析命令行参数
    const options = parseArgs(process.argv.slice(2));
    
    // 初始化数据库
    const db = await initDatabase();
    
    // 构建并执行查询
    const { query, params } = buildQuery(options);
    const data = executeQuery(db, query, params);
    
    // 根据格式选项输出结果
    switch (options.format) {
      case 'table':
        formatAsTable(data);
        showStats(data);
        break;
        
      case 'json':
        formatAsJson(data);
        break;
        
      case 'csv':
        if (options.export) {
          exportToCsvFile(data, options.export);
        } else {
          formatAsCsv(data);
        }
        break;
        
      default:
        console.error(`不支持的格式: ${options.format}`);
        process.exit(1);
    }
    
    // 关闭数据库
    db.close();
    
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

// 执行主函数
main();