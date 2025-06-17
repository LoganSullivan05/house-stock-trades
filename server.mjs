import yahoo from "yahoo-finance2";
import express from 'express';
import fs from 'fs';

function readJSONSync(file){
  return JSON.parse(fs.readFileSync(file).toString());
}

async function getHistoricalData(symbol, last_date) {
  const res = await yahoo.historical(symbol, {
	period1: last_date,
	period2: new Date(),
	interval: "1d"
  });

  return res;
}

async function updateSymbol(symbol){
	try{
		const todays_date = new Date().toDateString();
		if(symbol_updates[symbol] == todays_date) return;

		const file_path = `data/stock_data/${symbol}.json`;
		const trades = readJSONSync(file_path);
		
		const last_date_str = trades[trades.length - 1].date;
		const last_date = new Date(last_date_str);
		last_date.setDate(last_date.getDate() + 1);
		
		const symbol_historical_data = await getHistoricalData(symbol, last_date);
		const symbol_combined_data = [...trades, ...symbol_historical_data];
		fs.writeFileSync(file_path, JSON.stringify(symbol_combined_data));

		symbol_updates[symbol] = todays_date;
	}
	catch(e){
		console.log("Error fetching symbol: " + symbol);
		console.log(e);
	}
}

function getStockTradesByFrequency(max_months_ago){

	const symbol_keys_copy = [...symbol_keys];
	// 1M: 1, 1Y: 12, 5Y: 60
	const min_time = new Date();
	// min_time.setFullYear(min_time.getFullYear() - 1);
	min_time.setMonth(min_time.getMonth() - max_months_ago);

	let frequencies = {};

	symbol_keys.forEach(symbol => {
		
		frequencies[symbol] = 0;
		const trades = symbols[symbol];
		
		for(let i=0;i<trades.length;i++){
			const {trade_date} = trades[i];
			if(!trade_date) continue;
			if(new Date(trade_date) > min_time){
				frequencies[symbol]++;
			}
		}
		
	});

	symbol_keys_copy.sort((a,b) => frequencies[b] - frequencies[a]);
	return {frequencies, symbol_keys:symbol_keys_copy};
}

function getInsiderTradesByFrequency(max_months_ago){

	const insider_keys_copy = [...insider_keys];
	const min_time = new Date();
	// min_time.setFullYear(min_time.getFullYear() - 1);
	min_time.setMonth(min_time.getMonth() - max_months_ago);

	let frequencies = {};

	insider_keys.forEach(insider => {
		
		frequencies[insider] = 0;
		const trades = insiders[insider];
		
		for(let i=0;i<trades.length;i++){
			const {trade_date} = trades[i];
			if(!trade_date) continue;
			if(new Date(trade_date) > min_time){
				frequencies[insider]++;
			}
		}
		
	});

	insider_keys_copy.sort((a,b) => frequencies[b] - frequencies[a]);
	return {frequencies, insider_keys:insider_keys_copy};
}

function getCompanyName(symbol){
	if(!meta_data[symbol]) return "Unknown";
	return meta_data[symbol].displayName
	|| meta_data[symbol].shortName
	|| meta_data[symbol].longName 
	|| "Unknown";
}

const app = express();
const port = 3000;

const meta_data = readJSONSync("data/meta_data.json");
const symbol_updates = readJSONSync("data/symbol_updates.json");
const symbols = readJSONSync('data/symbol_data.json');
const insiders = readJSONSync('data/insider_data.json');

// delete the bad symbols
for(let symbol in symbols){
	if(fs.existsSync(`data/stock_data/${symbol}.json`)) continue;
	delete symbols[symbol];
}

// Using Infinity in dates causes NaN, use large month value for ALL
const symbol_keys = Object.keys(symbols);
symbol_keys.sort((a, b) => symbols[b].length - symbols[a].length);
const symbol_frequency_times = {};


symbol_frequency_times["1M"] = getStockTradesByFrequency(1);
symbol_frequency_times["6M"] = getStockTradesByFrequency(6);
symbol_frequency_times["1Y"] = getStockTradesByFrequency(12);
symbol_frequency_times["5Y"] = getStockTradesByFrequency(60);
symbol_frequency_times["10Y"] = getStockTradesByFrequency(120);
symbol_frequency_times["ALL"] = getStockTradesByFrequency(100000);

const insider_keys = Object.keys(insiders);
insider_keys.sort((a, b) => insiders[b].length - insiders[a].length);
const insider_frequency_times = {};

insider_frequency_times["1M"] = getInsiderTradesByFrequency(1);
insider_frequency_times["6M"] = getInsiderTradesByFrequency(6);
insider_frequency_times["1Y"] = getInsiderTradesByFrequency(12);
insider_frequency_times["5Y"] = getInsiderTradesByFrequency(60);
insider_frequency_times["10Y"] = getInsiderTradesByFrequency(120);
insider_frequency_times["ALL"] = getInsiderTradesByFrequency(100000);



app.use(express.static('website'));

app.get('/api/stocks/:symbol', async (req, res) => {
	const symbol = req.params.symbol.toUpperCase();
	const file_path = `data/stock_data/${symbol}.json`;
	
	if (!fs.existsSync(file_path)) {
		return res.status(404).json({ error: 'Stock data not found' });
	}
	
	await updateSymbol(symbol);
    const stock_data = readJSONSync(file_path);
    res.json(stock_data);
});

// Serve politician trades by symbol
app.get('/api/trades/:symbol', (req, res) => {
	const symbol = req.params.symbol.toUpperCase();

	if (symbols[symbol]) {
		res.json(symbols[symbol]);
	}
	else {
		res.status(404).json({ error: 'No trades found for symbol' });
	}
});

app.get('/api/companies/:symbol', (req, res) => {
	const symbol = req.params.symbol.toUpperCase();
	res.send(getCompanyName(symbol));
});

// for index.html cards
app.get('/api/list/stocks/:time_range', (req, res) => {
	const time_range = req.params.time_range;
	if (!symbol_frequency_times[time_range]) {
		return res.status(404).json({ error: 'Invalid time range' });
	}

	const { symbol_keys, frequencies } = symbol_frequency_times[time_range];

	// Get start/end from query (default to top 100)
	const start = parseInt(req.query.start) || 0;
	const end = parseInt(req.query.end) || 100;

	const sliced_symbols = symbol_keys.slice(start, end);	

	const result = sliced_symbols.map(symbol => ({
		symbol: symbol,
		company: getCompanyName(symbol),
		frequency: frequencies[symbol] || 0
	}));

	res.json(result);
});

app.get('/api/list/politicians/:time_range', (req, res) => {
	const time_range = req.params.time_range;
	
	if (!insider_frequency_times[time_range]) {
		return res.status(404).json({ error: 'Invalid time range' });
	}

	const { insider_keys, frequencies } = insider_frequency_times[time_range];

	// Get start/end from query (default to top 100)
	const start = parseInt(req.query.start) || 0;
	const end = insider_keys.length || parseInt(req.query.end) || insider_keys.length;

	const sliced_insiders = insider_keys.slice(start, end);	

	const result = sliced_insiders.map(insider => ({
		insider: insider,
		frequency: frequencies[insider] || 0
	}));

	res.json(result);
});

app.get('/api/politician/:insider', (req, res) => {
	const insider = req.params.insider;
	const decoded_insider = decodeURIComponent(insider);
	
	const trades_raw = insiders[decoded_insider];
	if(!trades_raw){
		return res.status(404).json({ error: 'Politician not found' });
	}
	//! returns less trades than it should if symbol isnt converted (ex. BRK.B stored as BRK-B)
	const trades = trades_raw.filter(trade => {
		return symbols[trade.symbol];
	});

	if (trades) res.json(trades);
	else {
		res.status(404).json({ error: 'Politician not found' });
	}
});

app.listen(port, () => {
	console.log(`Stock tracker API running at http://localhost:${port}`);
});


//TODO: be better than 2IQ
// - organize by commitees and sub-commitees

//TODO:
// - fix last edge case on cleanInsiderName (norto n)
// - correct old symbols (FB -> META)
// - add ads (ad space on index.html)
// - buy website

// politicianstocktracker.com
// politicianstocktrades.com
// housestocktrades.com

