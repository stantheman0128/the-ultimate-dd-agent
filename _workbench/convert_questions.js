#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {parseDraftTable}=require('./server');
const questions=require('./questions');
const dp=path.resolve(process.argv[2]),round=Number(process.argv[3]||1);
const target=path.join(dp,'_analysis','drafts',`questions_R${round}.json`);
if(fs.existsSync(target))throw new Error('JSON 正本已存在，不覆寫');
const result=questions.load(dp,round,parseDraftTable);
fs.writeFileSync(target,JSON.stringify(result.questions.map(({q,...rest})=>rest),null,2)+'\n');
console.log(`Converted ${result.questions.length} questions to ${target}`);
