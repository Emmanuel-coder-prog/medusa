"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = initial_data_seed;
const utils_1 = require("@medusajs/framework/utils");
const core_flows_1 = require("@medusajs/medusa/core-flows");
async function initial_data_seed({ container, }) {
    const logger = container.resolve(utils_1.ContainerRegistrationKeys.LOGGER);
    const link = container.resolve(utils_1.ContainerRegistrationKeys.LINK);
    const query = container.resolve(utils_1.ContainerRegistrationKeys.QUERY);
    const fulfillmentModuleService = container.resolve(utils_1.ModuleRegistrationName.FULFILLMENT);
    const countries = ["gb", "de", "dk", "se", "fr", "es", "it"];
    logger.info("Seeding store data...");
    const { result: [defaultSalesChannel], } = await (0, core_flows_1.createSalesChannelsWorkflow)(container).run({
        input: {
            salesChannelsData: [
                {
                    name: "Default Sales Channel",
                    description: "Created by Medusa",
                },
            ],
        },
    });
    const { result: [publishableApiKey], } = await (0, core_flows_1.createApiKeysWorkflow)(container).run({
        input: {
            api_keys: [
                {
                    title: "Default Publishable API Key",
                    type: "publishable",
                    created_by: "",
                },
            ],
        },
    });
    await (0, core_flows_1.linkSalesChannelsToApiKeyWorkflow)(container).run({
        input: {
            id: publishableApiKey.id,
            add: [defaultSalesChannel.id],
        },
    });
    const { result: [store], } = await (0, core_flows_1.createStoresWorkflow)(container).run({
        input: {
            stores: [
                {
                    name: "Default Store",
                    supported_currencies: [
                        {
                            currency_code: "eur",
                            is_default: true,
                        },
                        {
                            currency_code: "usd",
                            is_default: false,
                        },
                    ],
                    default_sales_channel_id: defaultSalesChannel.id,
                },
            ],
        },
    });
    logger.info("Seeding region data...");
    const { result: regionResult } = await (0, core_flows_1.createRegionsWorkflow)(container).run({
        input: {
            regions: [
                {
                    name: "Europe",
                    currency_code: "eur",
                    countries,
                    payment_providers: ["pp_system_default"],
                },
            ],
        },
    });
    const region = regionResult[0];
    logger.info("Finished seeding regions.");
    logger.info("Seeding tax regions...");
    await (0, core_flows_1.createTaxRegionsWorkflow)(container).run({
        input: countries.map((country_code) => ({
            country_code,
            provider_id: "tp_system",
        })),
    });
    logger.info("Finished seeding tax regions.");
    logger.info("Seeding stock location data...");
    const { result: stockLocationResult } = await (0, core_flows_1.createStockLocationsWorkflow)(container).run({
        input: {
            locations: [
                {
                    name: "European Warehouse",
                    address: {
                        city: "Copenhagen",
                        country_code: "DK",
                        address_1: "",
                    },
                },
            ],
        },
    });
    const stockLocation = stockLocationResult[0];
    await link.create({
        [utils_1.Modules.STOCK_LOCATION]: {
            stock_location_id: stockLocation.id,
        },
        [utils_1.Modules.FULFILLMENT]: {
            fulfillment_provider_id: "manual_manual",
        },
    });
    logger.info("Seeding fulfillment data...");
    // This is created by a migration script in core.
    const { data: shippingProfileResult } = await query.graph({
        entity: "shipping_profile",
        fields: ["id"],
    });
    const shippingProfile = shippingProfileResult[0];
    const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
        name: "European Warehouse delivery",
        type: "shipping",
        service_zones: [
            {
                name: "Europe",
                geo_zones: [
                    {
                        country_code: "gb",
                        type: "country",
                    },
                    {
                        country_code: "de",
                        type: "country",
                    },
                    {
                        country_code: "dk",
                        type: "country",
                    },
                    {
                        country_code: "se",
                        type: "country",
                    },
                    {
                        country_code: "fr",
                        type: "country",
                    },
                    {
                        country_code: "es",
                        type: "country",
                    },
                    {
                        country_code: "it",
                        type: "country",
                    },
                ],
            },
        ],
    });
    await link.create({
        [utils_1.Modules.STOCK_LOCATION]: {
            stock_location_id: stockLocation.id,
        },
        [utils_1.Modules.FULFILLMENT]: {
            fulfillment_set_id: fulfillmentSet.id,
        },
    });
    await (0, core_flows_1.createShippingOptionsWorkflow)(container).run({
        input: [
            {
                name: "Standard Shipping",
                price_type: "flat",
                provider_id: "manual_manual",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                type: {
                    label: "Standard",
                    description: "Ship in 2-3 days.",
                    code: "standard",
                },
                prices: [
                    {
                        currency_code: "usd",
                        amount: 10,
                    },
                    {
                        currency_code: "eur",
                        amount: 10,
                    },
                    {
                        region_id: region.id,
                        amount: 10,
                    },
                ],
                rules: [
                    {
                        attribute: "enabled_in_store",
                        value: "true",
                        operator: "eq",
                    },
                    {
                        attribute: "is_return",
                        value: "false",
                        operator: "eq",
                    },
                ],
            },
            {
                name: "Express Shipping",
                price_type: "flat",
                provider_id: "manual_manual",
                service_zone_id: fulfillmentSet.service_zones[0].id,
                shipping_profile_id: shippingProfile.id,
                type: {
                    label: "Express",
                    description: "Ship in 24 hours.",
                    code: "express",
                },
                prices: [
                    {
                        currency_code: "usd",
                        amount: 10,
                    },
                    {
                        currency_code: "eur",
                        amount: 10,
                    },
                    {
                        region_id: region.id,
                        amount: 10,
                    },
                ],
                rules: [
                    {
                        attribute: "enabled_in_store",
                        value: "true",
                        operator: "eq",
                    },
                    {
                        attribute: "is_return",
                        value: "false",
                        operator: "eq",
                    },
                ],
            },
        ],
    });
    logger.info("Finished seeding fulfillment data.");
    await (0, core_flows_1.linkSalesChannelsToStockLocationWorkflow)(container).run({
        input: {
            id: stockLocation.id,
            add: [defaultSalesChannel.id],
        },
    });
    logger.info("Finished seeding stock location data.");
    logger.info("Seeding product data...");
    const { result: categoryResult } = await (0, core_flows_1.createProductCategoriesWorkflow)(container).run({
        input: {
            product_categories: [
                {
                    name: "Shirts",
                    is_active: true,
                },
                {
                    name: "Sweatshirts",
                    is_active: true,
                },
                {
                    name: "Pants",
                    is_active: true,
                },
                {
                    name: "Merch",
                    is_active: true,
                },
            ],
        },
    });
    await (0, core_flows_1.createProductsWorkflow)(container).run({
        input: {
            products: [
                {
                    title: "Medusa T-Shirt",
                    category_ids: [
                        categoryResult.find((cat) => cat.name === "Shirts").id,
                    ],
                    description: "Reimagine the feeling of a classic T-shirt. With our cotton T-shirts, everyday essentials no longer have to be ordinary.",
                    handle: "t-shirt",
                    weight: 400,
                    status: utils_1.ProductStatus.PUBLISHED,
                    shipping_profile_id: shippingProfile.id,
                    images: [
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-back.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-front.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-back.png",
                        },
                    ],
                    options: [
                        {
                            title: "Size",
                            values: ["S", "M", "L", "XL"],
                        },
                        {
                            title: "Color",
                            values: ["Black", "White"],
                        },
                    ],
                    variants: [
                        {
                            title: "S / Black",
                            sku: "SHIRT-S-BLACK",
                            options: {
                                Size: "S",
                                Color: "Black",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "S / White",
                            sku: "SHIRT-S-WHITE",
                            options: {
                                Size: "S",
                                Color: "White",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "M / Black",
                            sku: "SHIRT-M-BLACK",
                            options: {
                                Size: "M",
                                Color: "Black",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "M / White",
                            sku: "SHIRT-M-WHITE",
                            options: {
                                Size: "M",
                                Color: "White",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "L / Black",
                            sku: "SHIRT-L-BLACK",
                            options: {
                                Size: "L",
                                Color: "Black",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "L / White",
                            sku: "SHIRT-L-WHITE",
                            options: {
                                Size: "L",
                                Color: "White",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "XL / Black",
                            sku: "SHIRT-XL-BLACK",
                            options: {
                                Size: "XL",
                                Color: "Black",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "XL / White",
                            sku: "SHIRT-XL-WHITE",
                            options: {
                                Size: "XL",
                                Color: "White",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                    ],
                    sales_channels: [
                        {
                            id: defaultSalesChannel.id,
                        },
                    ],
                },
                {
                    title: "Medusa Sweatshirt",
                    category_ids: [
                        categoryResult.find((cat) => cat.name === "Sweatshirts").id,
                    ],
                    description: "Reimagine the feeling of a classic sweatshirt. With our cotton sweatshirt, everyday essentials no longer have to be ordinary.",
                    handle: "sweatshirt",
                    weight: 400,
                    status: utils_1.ProductStatus.PUBLISHED,
                    shipping_profile_id: shippingProfile.id,
                    images: [
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-front.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-back.png",
                        },
                    ],
                    options: [
                        {
                            title: "Size",
                            values: ["S", "M", "L", "XL"],
                        },
                    ],
                    variants: [
                        {
                            title: "S",
                            sku: "SWEATSHIRT-S",
                            options: {
                                Size: "S",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "M",
                            sku: "SWEATSHIRT-M",
                            options: {
                                Size: "M",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "L",
                            sku: "SWEATSHIRT-L",
                            options: {
                                Size: "L",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "XL",
                            sku: "SWEATSHIRT-XL",
                            options: {
                                Size: "XL",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                    ],
                    sales_channels: [
                        {
                            id: defaultSalesChannel.id,
                        },
                    ],
                },
                {
                    title: "Medusa Sweatpants",
                    category_ids: [
                        categoryResult.find((cat) => cat.name === "Pants").id,
                    ],
                    description: "Reimagine the feeling of classic sweatpants. With our cotton sweatpants, everyday essentials no longer have to be ordinary.",
                    handle: "sweatpants",
                    weight: 400,
                    status: utils_1.ProductStatus.PUBLISHED,
                    shipping_profile_id: shippingProfile.id,
                    images: [
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatpants-gray-front.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatpants-gray-back.png",
                        },
                    ],
                    options: [
                        {
                            title: "Size",
                            values: ["S", "M", "L", "XL"],
                        },
                    ],
                    variants: [
                        {
                            title: "S",
                            sku: "SWEATPANTS-S",
                            options: {
                                Size: "S",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "M",
                            sku: "SWEATPANTS-M",
                            options: {
                                Size: "M",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "L",
                            sku: "SWEATPANTS-L",
                            options: {
                                Size: "L",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "XL",
                            sku: "SWEATPANTS-XL",
                            options: {
                                Size: "XL",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                    ],
                    sales_channels: [
                        {
                            id: defaultSalesChannel.id,
                        },
                    ],
                },
                {
                    title: "Medusa Shorts",
                    category_ids: [
                        categoryResult.find((cat) => cat.name === "Merch").id,
                    ],
                    description: "Reimagine the feeling of classic shorts. With our cotton shorts, everyday essentials no longer have to be ordinary.",
                    handle: "shorts",
                    weight: 400,
                    status: utils_1.ProductStatus.PUBLISHED,
                    shipping_profile_id: shippingProfile.id,
                    images: [
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/shorts-vintage-front.png",
                        },
                        {
                            url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/shorts-vintage-back.png",
                        },
                    ],
                    options: [
                        {
                            title: "Size",
                            values: ["S", "M", "L", "XL"],
                        },
                    ],
                    variants: [
                        {
                            title: "S",
                            sku: "SHORTS-S",
                            options: {
                                Size: "S",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "M",
                            sku: "SHORTS-M",
                            options: {
                                Size: "M",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "L",
                            sku: "SHORTS-L",
                            options: {
                                Size: "L",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                        {
                            title: "XL",
                            sku: "SHORTS-XL",
                            options: {
                                Size: "XL",
                            },
                            prices: [
                                {
                                    amount: 10,
                                    currency_code: "eur",
                                },
                                {
                                    amount: 15,
                                    currency_code: "usd",
                                },
                            ],
                        },
                    ],
                    sales_channels: [
                        {
                            id: defaultSalesChannel.id,
                        },
                    ],
                },
            ],
        },
    });
    logger.info("Finished seeding product data.");
    logger.info("Seeding inventory levels.");
    const { data: inventoryItems } = await query.graph({
        entity: "inventory_item",
        fields: ["id"],
    });
    await (0, core_flows_1.createInventoryLevelsWorkflow)(container).run({
        input: {
            inventory_levels: inventoryItems.map((item) => ({
                location_id: stockLocation.id,
                stocked_quantity: 1000000,
                inventory_item_id: item.id,
            })),
        },
    });
    logger.info("Finished seeding inventory levels data.");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5pdGlhbC1kYXRhLXNlZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvbWlncmF0aW9uLXNjcmlwdHMvaW5pdGlhbC1kYXRhLXNlZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF3QkEsb0NBK3lCQztBQXQwQkQscURBS21DO0FBQ25DLDREQWVxQztBQUV0QixLQUFLLFVBQVUsaUJBQWlCLENBQUMsRUFDOUMsU0FBUyxHQUdWO0lBQ0MsTUFBTSxNQUFNLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxpQ0FBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNuRSxNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLGlDQUF5QixDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9ELE1BQU0sS0FBSyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsaUNBQXlCLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDakUsTUFBTSx3QkFBd0IsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUNoRCw4QkFBc0IsQ0FBQyxXQUFXLENBQ25DLENBQUM7SUFFRixNQUFNLFNBQVMsR0FBRyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRTdELE1BQU0sQ0FBQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztJQUNyQyxNQUFNLEVBQ0osTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsR0FDOUIsR0FBRyxNQUFNLElBQUEsd0NBQTJCLEVBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUFDO1FBQ25ELEtBQUssRUFBRTtZQUNMLGlCQUFpQixFQUFFO2dCQUNqQjtvQkFDRSxJQUFJLEVBQUUsdUJBQXVCO29CQUM3QixXQUFXLEVBQUUsbUJBQW1CO2lCQUNqQzthQUNGO1NBQ0Y7S0FDRixDQUFDLENBQUM7SUFFSCxNQUFNLEVBQ0osTUFBTSxFQUFF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