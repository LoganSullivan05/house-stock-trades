import jsdom from 'jsdom';
import yahoo from "yahoo-finance2";
import fetch from "node-fetch";
import fs from 'fs';
import child_process from 'child_process';

const {JSDOM} = jsdom;

function readJSONSync(file){
  return JSON.parse(fs.readFileSync(file).toString());
}

function ensureDirExistsSync(dir){
  if(fs.existsSync(dir)) return;
  fs.mkdirSync(dir);
}

function contains(str, delimiter){
  return str.split(delimiter).length >= 2;
}

function capitalizeWord(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function cleanInsiderName(insider){
  // combine any lowcase sequence with the previous upper case seq.
  let sliced = insider.split(".").slice(1, insider.length);
  if(sliced.length < 1) sliced = [insider];
  // removd first step: sliced.join(".").trim()
  const clean = insider // seq. needs to be >=2 chars, edge cas e has one
    .replace(/([A-Z][a-z]+)\s+([a-z]{2,})\b/g, (match, a, b) => a + b)
    .toLowerCase()
    .replaceAll("honorable", "")
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\b(hon|mr|mrs|ms|dr|md|jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  //! ERROR CASE: "Hon. Eleanor Holmes Norto n " returns "Eleanor Norto"; missing "n"
  //! this is the only error found from this regex, other than McN -> Mcn

  // return clean;
  if(!clean || clean == "") console.log(insider);
  let parts = clean.split(" ").filter(part => part.length > 1);
  const capitalized = capitalizeWord(parts[0]) + " " + capitalizeWord(parts[parts.length - 1]);
  if(capitalized == "Trott Trott") console.log("trott: "+insider);
  
  return capitalized;
}

// python script is used since the PyPDF library can better parse these PDFs
function parsePDF(file_name, out_name){
  let args = ["read_pdf.py", file_name];
  if(out_name) args.push(out_name);

  const text_file = out_name || file_name.replace(".pdf", ".txt");
  
  if(!fs.existsSync(text_file)){
    child_process.execFileSync("python", args);
  }
  
  const text = fs.readFileSync(text_file).toString();
  const cleaned_text = text.replaceAll("\0", "").replaceAll("\r", "");
  return textExtractionRaw(cleaned_text);

}

async function fetchAllLinks(){

  // Removing the headers will cause this request to pull all disclosures (2014-present)
  const res = await fetch("https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult", {
      "body": "LastName=&FilingYear=2025&State=&District=",
      "method": "POST"
  });

  const text = await res.text();

  const base_url = "https://disclosures-clerk.house.gov/";

  const dom = new JSDOM(`<html><body> ${text} </body></html>`);
  const {document} = dom.window;

  const links = document.querySelectorAll("a");
  let ptr_links = [];

  links.forEach(a => {
    if(!contains(a.href, "ptr-pdfs")) return;
    ptr_links.push(base_url + a.href);
  });

  ensureDirExistsSync("data");
  fs.writeFileSync("data/ptr_links.json", JSON.stringify(ptr_links));
  return ptr_links;
}

async function fetchCurrentLinks(){

  const current_year = new Date().getFullYear();
  // Removing the headers will cause this request to pull all disclosures (2014-present)
  const res = await fetch("https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult", {
      "headers": {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": "https://disclosures-clerk.house.gov/FinancialDisclosure",
        "Referrer-Policy": "unsafe-url"
      },
      "body": "LastName=&FilingYear="+current_year+"&State=&District=",
      "method": "POST"
  });

  const text = await res.text();

  const base_url = "https://disclosures-clerk.house.gov/";

  const dom = new JSDOM(`<html><body> ${text} </body></html>`);
  const {document} = dom.window;

  const links = document.querySelectorAll("a");
  let ptr_links = [];

  links.forEach(a => {
    if(!contains(a.href, "ptr-pdfs")) return;
    ptr_links.push(base_url + a.href);
  });

  ensureDirExistsSync("data");
  fs.writeFileSync("data/ptr_links.json", JSON.stringify(ptr_links));
  return ptr_links;
}

function extractDate(str) {
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  let [, month, day, year] = match;    
  month = month.padStart(2, '0');
  day = day.padStart(2, '0');

  return `${month}/${day}/${year}`;
}

function textExtractionRaw(text){

  const split = text.split(/-\s?\$/);

  let transactions = [];
  
  split.forEach(str => {
    
    str = str.replaceAll("\n", "")
      .replaceAll("(partial)", "")
      .replace("] ", "]");

    if(!contains(str, "(")) return;
    if(contains(str, "Digitally Signed:")) return;

    let dates = [];
    // match any word with >=2 forward slashes, then remove any non-digits exluding "/"
    str.matchAll(/\S*\/\S*\/\S*/g)
      .forEach(val =>{
        const date_raw = val[0].replace(/[^\d/]/g, "");
        const date = extractDate(date_raw);
        dates.push(date);
      }
    );
    
    const trade_date = dates[dates.length-2];
    const notification_date = dates[dates.length-1];

    const para_split = str.split("(");
    const symbol = para_split[para_split.length-1].split(")")[0];

    //! type can be "E" for exchange, but thats uncommon
    // "]E" || "] E" -> = E
    let buy_or_sell = "S";
    if(contains(str, "]P") || contains(str, "] P")
    || contains(str, ")P") || contains(str, ") P")){
      buy_or_sell = "P";
    }

    const dollar_split = str.split("$");
    const dollars = dollar_split[dollar_split.length-1].replace(/,/g, "");
    const dollars_int = parseInt(dollars);

    const min_map = {
      1: 1000,
      1001: 15000,
      15001: 50000,
      50001: 100000,
      100001: 250000,
      250001: 500000,
      500001: 1000000,
      1000001: 5000000,
      5000001: 25000000,
      25000001: 50000000,
      50000001: 100000000
    };

    const data = {
      // uncomment "str" to debug parsing
      "str":str || null,
      "symbol":symbol || null,
      "buy_or_sell":buy_or_sell || null,
      
      "trade_date":trade_date || null,
      "notification_date":notification_date || null,

      "min_price":dollars_int || null,
      "max_price":min_map[dollars_int] || null
    };
    
    transactions.push(data);
  });
  
  let insider;

  if(contains(text, "Digitally Signed: ")){
    insider = text.split("Digitally Signed: ")[1].split(",")[0]?.replaceAll("\n","");
  }
  
  return {insider, transactions};
}

async function downloadPTR(downloadAll = false){
  
  let ptr_links;
  if(downloadAll) ptr_links = await fetchAllLinks();
  else ptr_links = await fetchCurrentLinks();
  
  ensureDirExistsSync("data/house_pdfs");

  for(let i=0;i<ptr_links.length;i++){
    
    const split = ptr_links[i].split("/");
    const pdf_ref = split[split.length-1];
    const file_name = "data/house_pdfs/" + pdf_ref;

    if(fs.existsSync(file_name)) continue;

    const res = await fetch(ptr_links[i]);
    const buffer = await res.buffer();
    fs.writeFileSync(file_name, buffer);
  }
  
}

function toTransactions(data){
  let total_transactions = [];
  
  for(let pdf in data){
    const {insider, transactions} = data[pdf];
    
    transactions.forEach(transaction => {
      const transaction_clone = {...transaction, insider, pdf};
      // remove "str" debug feature
      // delete transaction_clone["str"];
      total_transactions.push(transaction_clone);
    });
  }

  return total_transactions;
}

function writeLargeJSONArray(output, array){
  const stream = fs.createWriteStream(output);
  stream.write('[\n');

  for (let i = 0; i < array.length; i++) {
    const chunk = JSON.stringify(array[i]);
    stream.write(chunk + (i < array.length - 1 ? ',\n' : '\n'));
  }

  stream.write(']');
  stream.end();
}

async function getHistoricalTenYear(symbol) {
  const res = await yahoo.historical(symbol, {
    period1: new Date("2014-01-01"),
    period2: new Date(),
    interval: "1d"
  });

  return res;
}

async function scrapePDFs(downloadAll){
  ensureDirExistsSync("data");
  ensureDirExistsSync("data/house_pdfs");
  ensureDirExistsSync("data/house_txts");

  await downloadPTR(downloadAll);

  const dir = fs.readdirSync("data/house_pdfs");
  const files = {};

  dir.forEach(file => {
    const name = "data/house_pdfs/" + file;
    const out_file = "data/house_txts/" + file.replace(".pdf", ".txt");
    files[file] = parsePDF(name, out_file);
  });

  fs.writeFileSync("data/house_trade_data.json", JSON.stringify(files));
  const total_transactions = toTransactions(files);
  writeLargeJSONArray("data/transactions.json", total_transactions);
}

async function scrapeSymbols(){

  ensureDirExistsSync("data");
  ensureDirExistsSync("data/stock_data");
  const symbols = readJSONSync("data/symbols.json");

  let symbol_errors = readJSONSync("data/symbol_errors.json");

  //TODO: fetch meta data for new symbols & append it
  for(let symbol of symbols){
    try{
      if(fs.existsSync(`data/stock_data/${symbol}.json`)) continue;
      if(symbol_errors.includes(symbol)) continue;
      console.log("Scraping: "+symbol);
      
      const symbol_historical_data = await getHistoricalTenYear(symbol);
      console.log(symbol+" : "+symbol_historical_data.length);
      fs.writeFileSync(`data/stock_data/${symbol}.json`, JSON.stringify(symbol_historical_data));
    }
    catch{
      symbol_errors.push(symbol);
      console.log("Error fetching symbol: " + symbol);
    }
  }

  symbol_errors = [...new Set(symbol_errors)];
  fs.writeFileSync("data/symbol_errors.json", JSON.stringify(symbol_errors));
}

function organizeTransactionsBySymbol(){
  const transactions = readJSONSync("data/transactions.json");
  let symbols = {};

  transactions.forEach(transaction => {
    let {symbol, trade_date, min_price, insider, buy_or_sell} = transaction;
    if(!symbol) return;

    symbol = symbol.replaceAll(" ", "").toUpperCase();
    if(!symbols[symbol]) symbols[symbol] = [];
    
    insider = cleanInsiderName(insider);

    symbols[symbol].push({trade_date, buy_or_sell, insider, buy_amount:min_price});
  });

  const symbol_keys = Object.keys(symbols);
  symbol_keys.sort((a,b) => symbols[b].length - symbols[a].length);
  console.log(symbol_keys);

  fs.writeFileSync("data/symbol_data.json", JSON.stringify(symbols));
  fs.writeFileSync("data/symbols.json", JSON.stringify(Object.keys(symbols)));
}


function organizeTransactionsByPolitician(){
  const transactions = readJSONSync("data/transactions.json");
  const insiders = {};

  transactions.forEach(transaction => {
    let {symbol, trade_date, min_price, insider, buy_or_sell} = transaction;
    if(!symbol) return;
    
    symbol = symbol.replaceAll(" ", "").toUpperCase();
    insider = cleanInsiderName(insider);

    if(!insiders[insider]) insiders[insider] = [];
    insiders[insider].push({trade_date, buy_or_sell, symbol, buy_amount:min_price});
  });

  console.log(Object.keys(insiders));
  fs.writeFileSync("data/insider_data.json", JSON.stringify(insiders));
}

async function initialize(){



  await scrapePDFs(true);
  await scrapeSymbols();
  organizeTransactionsBySymbol();
  organizeTransactionsByPolitician();
}

// const bad_symbol_map = readJSONSync("data/bad_symbol_map.json");
// function correctSymbol(symbol){
//   if(fs.existsSync(`data/stock_data/${symbol}.json`)){
//     return symbol;
//   }

//   return bad_symbol_map[symbol];
// }

// await getSymbolMetaData();

// Scrape & parse PDFS
// await scrapePDFs();
// await scrapeSymbols();
// organizeTransactionsBySymbol();
// organizeTransactionsByPolitician();

// const symbol_data = readJSONSync("data/symbol_data.json");
// const symbol_errors = readJSONSync("data/symbol_errors.json");

// let transactions_missed = 0;
// let money_unaccounted = 0;

// symbol_errors.forEach(symbol => {
//   const transactions_length = symbol_data[symbol].length;
//   if(correctSymbol(symbol)) return;
//   console.log(symbol);
  
//   symbol_data[symbol].forEach(transaction => {
//     money_unaccounted += transaction.buy_amount || 0;
//   });

//   transactions_missed += transactions_length;
// });

// console.log("Transactions missed: "+transactions_missed);
// console.log("Money unaccounted for: "+money_unaccounted);

/*

ORIGINAL:
Transactions missed: 6093
Money unaccounted for: 167280092

NEW:
Transactions missed: 3457
Money unaccounted for: 121130456

*/


/*
symbol anomolies (no mkt cap or assets): [
  'SRCL',   'SPWR',   'MLPN',  
  'SEMG',   'TMH',    'ARMH',  
  'SBMRY',  'CJNK',   'BUNT',  
  'TTFS',   'RSCO',   'DNO',   
  'QCGLIX', 'QCGRIX', 'QCSTIX',
  'QREARX', 'CIU',    'RPT',   
  'KPLTW',  'AXHE',   'AXTE',  
  'HTZWW',  'VIASP',  'OZKAP', 
  'ITIP',   'SMCY',   'MHVIY'  
]
*/