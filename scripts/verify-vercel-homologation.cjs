'use strict';
// Narrow exception to byte-for-byte operational protection. This fingerprint is
// the original f813240 vercel.json plus ONLY deploymentEnabled[reviewBranch]=false.
// Any edit (including removal, wildcard, routing or formatting) requires review.
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const APPROVED='66bffc3f95828b1ad7195d42189c46a08826c09e15e5c0ccbbb66e855bf249e9';
let fd;
try{
 const before=fs.lstatSync('vercel.json');
 if(!before.isFile()||before.isSymbolicLink())throw Error('not a regular file');
 fd=fs.openSync('vercel.json',fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 const opened=fs.fstatSync(fd);
 if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw Error('file changed');
 const sha=createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
 if(sha!==APPROVED)throw Error('unreviewed content');
 console.log('PASS: exact Vercel homologation-only deployment block; original settings preserved.');
}catch{
 console.error('BLOCKED: vercel configuration is missing, unsafe or outside the reviewed exception.');
 process.exitCode=1;
}finally{
 if(fd!==undefined)fs.closeSync(fd);
}
