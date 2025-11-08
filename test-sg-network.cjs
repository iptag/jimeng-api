#!/usr/bin/env node

/**
 * 国际站SG区域网络连接诊断脚本
 * 用于测试能否访问新加坡ImageX服务
 */

const dns = require('dns').promises;
const https = require('https');

const SG_DOMAINS = [
  'mweb-api-sg.capcut.com',
  'imagex16-normal-sg-ttp.capcutapi.sg'
];

console.log('=== 国际站SG区域网络诊断 ===\n');

async function testDNS(domain) {
  console.log(`[DNS测试] 正在解析: ${domain}`);
  try {
    const addresses = await dns.resolve4(domain);
    console.log(`✓ DNS解析成功: ${domain} -> ${addresses.join(', ')}`);
    return true;
  } catch (error) {
    console.error(`✗ DNS解析失败: ${domain}`);
    console.error(`  错误: ${error.message}`);
    return false;
  }
}

async function testHTTPS(domain) {
  console.log(`\n[HTTPS测试] 正在测试连接: https://${domain}`);
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = https.get(`https://${domain}`, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      const duration = Date.now() - startTime;
      console.log(`✓ HTTPS连接成功: ${domain}`);
      console.log(`  状态码: ${res.statusCode}`);
      console.log(`  响应时间: ${duration}ms`);
      res.resume();
      resolve(true);
    });

    req.on('error', (error) => {
      const duration = Date.now() - startTime;
      console.error(`✗ HTTPS连接失败: ${domain}`);
      console.error(`  错误类型: ${error.code || error.constructor.name}`);
      console.error(`  错误信息: ${error.message}`);
      console.error(`  耗时: ${duration}ms`);

      if (error.code === 'ENOTFOUND') {
        console.error(`  建议: DNS无法解析该域名，请检查DNS设置或网络连接`);
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        console.error(`  建议: 无法连接到服务器，可能需要配置代理或检查防火墙`);
      } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        console.error(`  建议: SSL证书问题，可能是系统时间不正确或证书链不完整`);
      }

      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.error(`✗ HTTPS连接超时: ${domain}`);
      console.error(`  建议: 网络延迟过高或无法访问，请检查网络连接或配置代理`);
      resolve(false);
    });
  });
}

async function testImageXAPI() {
  console.log(`\n[API测试] 测试ImageX API端点`);
  const testUrl = 'https://imagex16-normal-sg-ttp.capcutapi.sg/?Action=GetImageServiceSubscriptions&Version=2018-08-01';

  return new Promise((resolve) => {
    const startTime = Date.now();
    https.get(testUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    }, (res) => {
      const duration = Date.now() - startTime;
      console.log(`✓ ImageX API端点可访问`);
      console.log(`  状态码: ${res.statusCode}`);
      console.log(`  响应时间: ${duration}ms`);

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`  响应示例: ${data.substring(0, 200)}...`);
        } catch (e) {
          console.log(`  响应: ${data.substring(0, 200)}...`);
        }
        resolve(true);
      });
    }).on('error', (error) => {
      console.error(`✗ ImageX API端点访问失败`);
      console.error(`  错误: ${error.message}`);
      resolve(false);
    });
  });
}

async function main() {
  let allSuccess = true;

  // 测试DNS解析
  console.log('步骤 1: DNS解析测试');
  console.log('─'.repeat(50));
  for (const domain of SG_DOMAINS) {
    const success = await testDNS(domain);
    if (!success) allSuccess = false;
  }

  // 测试HTTPS连接
  console.log('\n步骤 2: HTTPS连接测试');
  console.log('─'.repeat(50));
  for (const domain of SG_DOMAINS) {
    const success = await testHTTPS(domain);
    if (!success) allSuccess = false;
  }

  // 测试API端点
  console.log('\n步骤 3: API端点测试');
  console.log('─'.repeat(50));
  const apiSuccess = await testImageXAPI();
  if (!apiSuccess) allSuccess = false;

  // 总结
  console.log('\n' + '='.repeat(50));
  if (allSuccess) {
    console.log('✓ 所有测试通过！网络连接正常');
  } else {
    console.log('✗ 部分测试失败，请检查上述错误信息');
    console.log('\n常见解决方案:');
    console.log('1. 检查是否需要配置代理 (HTTP_PROXY/HTTPS_PROXY环境变量)');
    console.log('2. 检查DNS设置是否正确');
    console.log('3. 检查防火墙是否阻止了访问');
    console.log('4. 尝试使用VPN连接');
    console.log('5. 检查系统时间是否正确 (影响SSL证书验证)');
  }
  console.log('='.repeat(50));
}

main().catch(console.error);
