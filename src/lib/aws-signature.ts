import crypto from "crypto";

/**
 * AWS4-HMAC-SHA256 签名生成函数
 * 用于即梦API的请求签名
 */
export function createSignature(
  method: string,
  url: string,
  headers: { [key: string]: string },
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
  payload: string = '',
  region: string = 'cn-north-1',
  service: string = 'imagex'
) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';
  const search = urlObj.search;

  // 创建规范请求
  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  
  // 规范化查询参数
  const queryParams: Array<[string, string]> = [];
  const searchParams = new URLSearchParams(search);
  searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  
  // 按键名排序
  queryParams.sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  
  const canonicalQueryString = queryParams
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  
  // 规范化头部
  const headersToSign: { [key: string]: string } = {
    'x-amz-date': timestamp
  };
  
  if (sessionToken) {
    headersToSign['x-amz-security-token'] = sessionToken;
  }
  
  let payloadHash = crypto.createHash('sha256').update('').digest('hex');
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    headersToSign['x-amz-content-sha256'] = payloadHash;
  }
  
  const signedHeaders = Object.keys(headersToSign)
    .map(key => key.toLowerCase())
    .sort()
    .join(';');
  
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key.toLowerCase()}:${headersToSign[key].trim()}\n`)
    .join('');
  
  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  // 创建待签名字符串
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n');
  
  // 计算签名
  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
