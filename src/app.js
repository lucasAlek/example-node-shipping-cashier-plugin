const bodyParser = require('body-parser');
const express = require('express');
const request = require('request-promise');
const { verify_signature, log } = require('./middleware');

const app = express();

app.use(log, bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.get('/widget', (req, res) => {
    res.sendFile('views/widget.html', { root: __dirname });
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

    const scope = [
        'add_payments',
        'modify_cart',
        'provide_shipping_rates',
        'read_shipping_lines',
        'read_orders',
        'modify_shipping_address'
    ].join(' ');

    res.redirect(
        `https://${domain}/api/v1/${platform}/${shop}/oauth/authorize?client_id=${client_id}&scope=${scope}&response_type=code`
    );
});

// request expects three different query string parameters,
//  platform: e.g. shopify
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

app.post('/oauth/uninstalled', verify_signature, (req, res) => {
    const platform = req.query.platform;
    const shop = req.query.shop;

    //TODO: mark shop as uninstalled in database

    res.send();
});

app.post('/cashier/event', verify_signature, (req, res) => {
    //res.send(req.body.event);
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

app.post('/shipping', verify_signature, (req, res) => {
    console.log(req.body);
    const platform = req.query.platform;
    console.log(req.query)
    const shop = req.query.shop;

    if (
        typeof platform === 'undefined' ||
        typeof shop === 'undefined'
    ) {
        res.status(400).send('Error: "shop" is required');
    }

    const domain = process.env.CASHIER_DOMAIN;
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
            "items": [
                {
                    "price": 500,
                    "quantity": 1,
                    "grams": 250
                },
                {
                    "price": 300,
                    "quantity": 2,
                    "grams": 150
                }
            ]
        }
    };

    request({
        url: `https://${domain}/api/v1/${platform}/${shop}/shipping_lines`,
        method: 'POST',
        headers: {
            "X-Bold-Checkout-Access-Token": "ih3ohfqUlcTMzxJG8cjgvyVwuJsn7olmzDkDdUjTcCn4NZPT1O1ne9UUqPiWGkC1",
        },
        json: requestData,
    })
        .then(resp => {
            //TODO: get the rates form checkout and set them in the override along with my own rate
            console.log(resp);
            var shipping_lines = resp.shipping_lines; 
            var numberLines = Object.keys(shipping_lines).length;
            var rates = new Array(); 
            
            var i; 
            for( i= 0; i < numberLines; i++){
                rates.push({
                    "line_text" : shipping_lines[i].shipping.name,
                    "value": (shipping_lines[i].shipping.price/100)
                });
            }
            //console.log(rates); 

            res.send({
                name: 'My Custom Shipping Override',
                rates:  rates,                
            });
        })
        .catch(err => {
            //TODO: report error
            console.log(err);
            res.status(500).end();
        });
    
});

app.post('/payment/preauth', verify_signature, (req, res) => {
    if (req.body.payment.value >= 100000) {
        res.send({
            success: false,
            error: 'payment exceeds maximum value',
        });
    } else {
        res.send({
            success: true,
            reference_id: 'payment-12345',
        });
    }
});

app.post('/payment/capture', verify_signature, (req, res) => {
    res.send({
        success: true,
        reference_id: 'payment-12345',
    });
});

app.post('/payment/refund', verify_signature, (req, res) => {
    res.send({
        success: true,
        reference_id: 'payment-12345',
    });
});

function handleEvent(req) {
    switch (req.body.event) {
        case 'initialize_checkout':
            return handleInitializeCheckout(req);
        case 'received_shipping_lines':
            return handleReceivedShiipingLines(req);
        case 'app_hook':
            return handleAppHook(req);
        default:
            return [];
    }
}

function handleInitializeCheckout(req) {
    return [
    //     {
    //         type: 'APP_UPDATE_WIDGET',
    //         data: {
    //             name: 'my_payments_widget',
    //             type: 'iframe',
    //             position: 'payments',
    //             source: process.env.APP_URL + '/widget',
    //             frame_origin: process.env.APP_URL,
    //         },
    //     },
    //     {
    //         type: 'APP_UPDATE_WIDGET',
    //         data: {
    //             name: 'my_discount_widget',
    //             type: 'app_hook',
    //             position: 'discount',
    //             text: 'Discount 5%',
    //             icon: 'https://via.placeholder.com/50x50.png',
    //             click_hook: 'apply_discount',
    //         },
    //     },
    //     {
    //         type: 'APP_UPDATE_WIDGET',
    //         data: {
    //             name: 'my_payment_method',
    //             type: 'app_hook',
    //             position: 'payment_gateway',
    //             text: 'Pay via the honor system',
    //             click_hook: 'add_payment',
    //         },
    //     },
        {
            type: 'OVERRIDE_SHIPPING',
            data: {
                url: process.env.APP_URL + '/shipping',
            },
        },
    ];
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

function handleReceivedShiipingLines(req) {
    console.log("shipping lines Received " , JSON.parse(req.body));

    //Save user settings to DB
}

function handleAppHook(req) {
    // switch (req.body.properties.hook) {
    // }

}

module.exports = app;
