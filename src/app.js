const bodyParser = require('body-parser');
const express = require('express');
const request = require('request-promise');
const { verify_signature, log } = require('./middleware');

const app = express();

app.use(log, bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// request expects two different query string parameters,
//  platform: e.g. shopify
//  shop: e.g. example.myshopify.com or store-wxyz.mybigcommerce.com
app.get('/oauth/redirect', (req, res) => {
    const domain = process.env.CASHIER_DOMAIN;
    const client_id = process.env.CASHIER_CLIENT_ID;

    const platform = req.query.platform;
    const shop = req.query.shop;

    if (typeof platform === 'undefined' || typeof shop === 'undefined') {
        res.status(400).send('Error: "shop" is required');
    }

    //there are a few scops in here that are not needed for the application but are a nice to have. "read_seetings" is the main one
    const scope = [
        'provide_shipping_rates',
        'read_shipping_lines',
        'modify_shipping',
        'read_orders',
        'modify_shipping_address',
        'read_shop_settings'
    ].join(' ');

    res.redirect(
        `https://${domain}/api/v1/${platform}/${shop}/oauth/authorize?client_id=${client_id}&scope=${scope}&response_type=code`
    );
});

// request expects three different query string parameters,
//  platform: e.g. shopify or bigcommerce 
//  shop: e.g. example.myshopify.com or store-wxyz.mybigcommerce.com
//  code: a temporary authorization code which you can exchange for a Cashier access token
app.get('/oauth/authorize', (req, res) => {
    const platform = req.query.platform;
    const shop = req.query.shop;
    const code = req.query.code;

    if (
        typeof code === 'undefined' ||
        typeof platform === 'undefined' ||
        typeof shop === 'undefined'
    ) {
        res.status(400).send('Error: "shop" is required');
    }

    const domain = process.env.CASHIER_DOMAIN;
    const requestData = {
        client_id: process.env.CASHIER_CLIENT_ID,
        client_secret: process.env.CASHIER_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
    };

    request({
        url: `https://${domain}/api/v1/${platform}/${shop}/oauth/access_token`,
        method: 'POST',
        json: requestData,
    })
        .then(resp => {
            //TODO: save access_token in order to perform Cashier API calls
            console.log(resp.access_token); 
            // at this point the app is free to redirect the user wherever it wants
            // this example redirects back into the Cashier admin
            res.redirect(
                `https://${domain}/admin/${platform}/${shop}/marketplace`
            );
        })
        .catch(err => {
            //TODO: report error
            res.status(500).end();
        });
});

app.post('/orderWebhook', (req,res) => {
    /* A webhook will be sent to this endpoint when the order is created. 
    You can use this to confirm any order information. For more info on order webhooks go here:
    */
   res.send({
       success: true,
   });
}); 

app.post('/oauth/uninstalled', verify_signature, (req, res) => {
    const platform = req.query.platform;
    const shop = req.query.shop;

    //TODO: mark shop as uninstalled in database

    res.send();
});

app.post('/cashier/event', verify_signature, (req, res) => {
    const actions = handleEvent(req);

    res.send({
        success: true,
        actions: actions,
    });
});

app.get('/settings', verify_signature, (req, res) => {
    const settings = handleSettingsPage(req);
    const token = req.query.token;

    if (typeof token === 'undefined') {
        res.status(400).send('Error: "token" is required');
    }

    res.send({
        token: req.query.token,
        settings: settings,
    });
});

app.post('/settings', verify_signature, (req, res) => {
    const settings = handleReceiveUserSettings(req);
    const token = req.query.token;

    if (typeof token === 'undefined') {
        res.status(400).send('Error: "token" is required');
    }

    res.send({
        token: req.token,
        settings: settings,
    });
});

// When a shipping override is triggered by the plugin checkout will hit this endpoint. 
// Checkout sends the source, destination address and current cart.
app.post('/shipping', verify_signature, (req, res) => {

    const platform = req.query.platform;
    const shop = req.query.shop;
    const domain = process.env.CASHIER_DOMAIN;

    if (
        typeof platform === 'undefined' ||
        typeof shop === 'undefined'
    ) {
        res.status(400).send('Error: "shop" is required');
    }

    //var numberItems = Object.keys(req.body.cart).length;
    var items = new Array(); 
    var isbopis = false;

    // gather all the cart items
    req.body.cart.forEach(function(item) {
        if(item.title.includes("pick up")){
            isbopis = true; 
        }
        items.push({
            "price": item.price,
            "quantity": item.quantity,
            "grams": item.weight
        }); 
    }); 
    
    if(!isbopis){
        GetShippingRate(req, items, domain, platform, shop, res);    
    }else{
        GetBopisRates(res); 
    }
});

function handleEvent(req) {
    switch (req.body.event) {
        case 'initialize_checkout':
            return handleInitializeCheckout(req);
        case 'order_submitted':
            return handleOrderSubmitted(req);
        default:
            return [];
    }
}

function handleInitializeCheckout(req) {
    var isbopis = false;

    req.body.cart.line_items.forEach(function(item) {
        if (item.title.includes("pick up")){
            isbopis = true; 
        }
    }); 
    /* there are two differt order styles that we are handling here.
    
    1. bpois
    A bopis order requires the bopis flag be set with the sections that are to be hidden. Define the rates that are to be overwritten and what the pick up location is 

    2.standared order
    We are only going to trigger a shipping rate override becuse we are again going to replace the Checkout supplied shipping rates with our own
    */
    if (isbopis){
        isbopis = false;
        return[
            {
                //bopis flag
                type: "FLAG_ORDER_AS_BOPIS",
                data: {
                    flag_order_as_bopis: true,
                    hidden_sections: {
                        shipping_address: true,
                        saved_addresses: true
                    },
                },
            },
            {
                //define the rates to be over written with out own
                type: 'OVERRIDE_SHIPPING',
                data: {
                    url: process.env.APP_URL + '/shipping',
                },
            },
            {
                //set the pickup location. ( this can be changed later on to suit a user selected location)
                type: "CHANGE_SHIPPING_ADDRESS",
                data: {
                    first_name: "John",
                    last_name: "Doe",
                    company: "Bold Commerce Ltd",
                    address: "50 Fultz Blvd",
                    address2: "Another Address Line",
                    phone: "204-678-9087",
                    city: "Winnipeg",
                    province: "Manitoba",
                    province_code: "MB",
                    country: "Canada",
                    country_code: "CA",
                    postal_code: "R3Y 0L6",
                    update_billing: false,
                    different_billing_address: true
                },
            },
        ];
    }else{  
        return[
            {
                type: 'OVERRIDE_SHIPPING',
                data: {
                    url: process.env.APP_URL + '/shipping',
                },
            },
        ];
    }
}

function handleSettingsPage(req) {
    //Missing: Load user values from DB, assign to `value` keys
    return {
        shortString1: {
            text: 'This is a short string field',
            type: 'stringShort',
            tooltip: 'Short string tooltip',
            placeholder: 'Short string placeholder',
            value: '',
            validation_schema: {},
        },
        regularString1: {
            text: 'This is a regular string field ',
            type: 'string',
            tooltip: 'Regular string tooltip',
            placeholder: 'Regular string placeholder',
            value: '',
            validation_schema: {},
        },
        number1: {
            text: 'This is a number field',
            type: 'number',
            tooltip: 'number tooltip',
            placeholder: 'Number placeholder',
            value: '',
            validation_schema: {},
        },
        checkbox1: {
            text: 'This is a checkbox',
            type: 'checkbox',
            tooltip: 'checkbox tooltip',
            value: '',
            validation_schema: {},
        },

        link1: {
            text: 'This is a link',
            type: 'link',
            value: 'https://www.google.ca',
            validation_schema: {},
        },
        horizontalRule1: {
            type: 'horizontalRule',
            validation_schema: {},
        },
        header1: {
            text: 'This is a header',
            type: 'header',
            tooltip: 'This is a header tooltip',
            validation_schema: {},
        },
        toggle1: {
            text: 'This is a toggle',
            type: 'toggle',
            tooltip: 'toggle tooltip',
            value: 1,
            validation_schema: {},
        },
        validationExampleNumber1: {
            text: 'This is required when the toggle is checked',
            type: 'number',
            tooltip: 'Turn off toggle to not require this field',
            placeholder: 'Number placeholder',
            value: '',
            validation_schema: {
                required_if: {
                    target: 'toggle1',
                    errorText: 'Required when toggle is on',
                },
                min: {
                    value: 5,
                    errorText: 'Must be greater than 5',
                },
                max: {
                    value: 1000,
                    errorText: 'Must be less than 1000',
                },
            },
        },
    };
}

function handleOrderSubmitted(req){
    // check user seleted rate or location
}


function GetBopisRates(res) {
    locations = new Array();
    var location_rates = new Array();

    //Hard coded the lat long set for downtown austin texes 
    var lat = 30.268466;
    var long = -97.742811;

    //TODO: get the locations from NASA fallen metorite open API and set them as the store pick up shipping lines
    // Radius is set to 100,000M or 100KM 
    // This is an example that you would replace with your own locatoin API or hardcoded locations
    request({
        url: `https://data.nasa.gov/resource/gh4g-9sfh.json?$where=within_circle(GeoLocation,${lat},${long}, 100000)`,
        method: 'GET',
        headers: {
            "X-App-Token": process.env.NASA_ACCESS_TOKEN,
        },
    })
        .then(resp => {
            // racived rates need to formated as Json, and add each one as possible rates with a $0 value
            location = resp;
            location = JSON.parse(location);

            location.forEach(function (place) {
                location_rates.push({
                    "line_text": place.name,
                    "value": 0
                });
            });
            res.send({
                name: 'Pick up: ',
                rates: location_rates,
            });
        })
        .catch(err => {
            //TODO: report error
            console.log(err);
            res.status(500).end();
        });
}

function GetShippingRate(req, items, domain, platform, shop, res) {
    const requestData = {
        "order": {
            "customer": {
                "shipping_address": {
                    "address": req.body.destination_address.address1,
                    "city": req.body.destination_address.city,
                    "country_code": req.body.destination_address.country_code,
                    "province_code": req.body.destination_address.province_code,
                    "postal_code": req.body.destination_address.postal_code
                }
            },
            "items": items,
        }
    };

    // request to bold checkout for the shipping rates that would apply for this order
    request({
        url: `https://${domain}/api/v1/${platform}/${shop}/shipping_lines`,
        method: 'POST',
        headers: {
            "X-Bold-Checkout-Access-Token": process.env.Bold_checkout_acccess_token,
        },
        json: requestData,
    })
        .then(resp => {
            //TODO: get the rates from checkout and set them in the override along with my own rate
            var shipping_lines = new Array();
            shipping_lines = Object.values(resp.shipping_lines);
            var rates = new Array();
            // get the rates that were fetched from checkout and format them for shipping override. 
            shipping_lines.forEach(function (line) {
                rates.push({
                    "line_text": line.shipping.name,
                    "value": (line.shipping.price / 100)
                });
            });
            // submit the override to checkout. 
            res.send({
                name: 'My Custom Shipping Override',
                rates: rates,
            });
        })
        .catch(err => {
            //TODO: report error
            console.log(err);
            res.status(500).end();
        });
}

module.exports = app;
