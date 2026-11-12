import {networkInterfaces} from 'node:os';

export function lanAddresses(){
  return [...new Set(Object.entries(networkInterfaces()).filter(([name])=>/^en\d+$/.test(name)).flatMap(([,addresses])=>addresses.filter(a=>a.family==='IPv4'&&!a.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a=>a.address)))];
}
export function requestOrigin(host,port,addresses=['127.0.0.1']){
  return addresses.some(address=>host===`${address}:${port}`)?`http://${host}`:null;
}
