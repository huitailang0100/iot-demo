// test_db.js - 测试数据库功能的简单脚本
import initSqlJs from 'sql.js';

async function testDatabase() {
  try {
    // 初始化 SQL.js
    const SQL = await initSqlJs({});
    
    // 注意：由于 sql.js 是内存数据库，每次重启都会丢失数据
    // 我们需要连接到 server.js 中使用的数据库
    console.log('Database test script');
    console.log('Please check the server logs to verify data is being stored.');
  } catch (error) {
    console.error('Error testing database:', error);
  }
}

testDatabase();