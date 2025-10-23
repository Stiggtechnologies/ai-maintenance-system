#!/usr/bin/env node
/**
 * Stripe Provisioning Script
 *
 * Creates Products and Prices for the billing system:
 * - 3 Plan tiers (STARTER, PRO, ENTERPRISE)
 * - Each plan has: Base recurring price + Metered credits price
 * - Optional: Asset uplift metered price
 *
 * Usage: npx tsx scripts/provision-stripe.ts
 *
 * Prerequisites:
 * - npm install stripe tsx
 * - Set STRIPE_SECRET_KEY in environment
 */

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20.acacia',
});

interface PlanOptions {
  code: 'STARTER' | 'PRO' | 'ENTERPRISE';
  name: string;
  baseMonthlyCAD: number;
  includedAssets: number;
  includedCredits: number;
  overagePerCredit: number;
  maxSites: number;
  metadata?: Record<string, string>;
}

async function createPlan(opts: PlanOptions) {
  console.log(`\n📦 Creating ${opts.code} plan...`);

  // Base subscription product
  const baseProduct = await stripe.products.create({
    name: `${opts.name} - Base Subscription`,
    description: `Monthly base subscription for ${opts.name}`,
    metadata: {
      code: opts.code,
      kind: 'base_plan',
      included_assets: String(opts.includedAssets),
      included_credits: String(opts.includedCredits),
      max_sites: String(opts.maxSites),
      ...opts.metadata,
    },
  });

  console.log(`  ✅ Base product: ${baseProduct.id}`);

  // Base recurring price
  const basePrice = await stripe.prices.create({
    product: baseProduct.id,
    currency: 'cad',
    unit_amount: Math.round(opts.baseMonthlyCAD * 100),
    recurring: { interval: 'month' },
    tax_behavior: 'exclusive',
    metadata: {
      code: opts.code,
      component: 'base',
    },
  });

  console.log(`  ✅ Base price: ${basePrice.id} ($${opts.baseMonthlyCAD} CAD/month)`);

  // Metered credits product
  const creditsProduct = await stripe.products.create({
    name: `${opts.name} - Inference Credits (Metered)`,
    description: `Pay-as-you-go inference credits for ${opts.name}`,
    metadata: {
      code: opts.code,
      kind: 'metered_credits',
      included_credits: String(opts.includedCredits),
    },
  });

  console.log(`  ✅ Credits product: ${creditsProduct.id}`);

  // Metered credits price (per credit)
  const creditsPrice = await stripe.prices.create({
    product: creditsProduct.id,
    currency: 'cad',
    unit_amount: Math.round(opts.overagePerCredit * 100),
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      aggregate_usage: 'sum',
    },
    tax_behavior: 'exclusive',
    metadata: {
      code: opts.code,
      component: 'credits',
      included_credits: String(opts.includedCredits),
      rate_per_credit: String(opts.overagePerCredit),
    },
  });

  console.log(`  ✅ Credits price: ${creditsPrice.id} ($${opts.overagePerCredit} CAD/credit)`);

  return {
    baseProduct,
    basePrice,
    creditsProduct,
    creditsPrice,
  };
}

async function createAssetUplift() {
  console.log('\n📦 Creating Asset Uplift (optional metered)...');

  const product = await stripe.products.create({
    name: 'Asset Uplift - Extra Assets Beyond Plan Limit',
    description: 'Metered charge for assets exceeding plan allocation',
    metadata: {
      component: 'asset_uplift',
    },
  });

  console.log(`  ✅ Product: ${product.id}`);

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'cad',
    unit_amount: 300, // $3.00 CAD per extra asset
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      aggregate_usage: 'sum',
    },
    tax_behavior: 'exclusive',
    metadata: {
      component: 'asset_uplift',
      rate_per_asset: '3.00',
    },
  });

  console.log(`  ✅ Price: ${price.id} ($3.00 CAD/asset/month)`);

  return { product, price };
}

async function main() {
  console.log('🚀 Stigg Reliability AI - Stripe Provisioning');
  console.log('============================================\n');

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }

  console.log('Using Stripe API version:', stripe.VERSION);

  // Create plans
  const STARTER = await createPlan({
    code: 'STARTER',
    name: 'Starter (Pilot)',
    baseMonthlyCAD: 4000,
    includedAssets: 200,
    includedCredits: 250000,
    overagePerCredit: 0.002,
    maxSites: 1,
  });

  const PRO = await createPlan({
    code: 'PRO',
    name: 'Pro (Scale)',
    baseMonthlyCAD: 9000,
    includedAssets: 1000,
    includedCredits: 1000000,
    overagePerCredit: 0.002,
    maxSites: 3,
  });

  const ENTERPRISE = await createPlan({
    code: 'ENTERPRISE',
    name: 'Enterprise (Autonomous)',
    baseMonthlyCAD: 18000,
    includedAssets: 3000,
    includedCredits: 5000000,
    overagePerCredit: 0.0015,
    maxSites: 8,
  });

  // Create asset uplift (optional)
  const ASSET_UPLIFT = await createAssetUplift();

  // Output environment variables
  console.log('\n\n✅ PROVISIONING COMPLETE!');
  console.log('=========================================\n');
  console.log('Add these to your .env or Supabase Edge Function secrets:\n');

  const envConfig = {
    STRIPE_ASSET_UPLIFT_PRICE: ASSET_UPLIFT.price.id,
    STRIPE_STARTER_BASE_PRICE: STARTER.basePrice.id,
    STRIPE_STARTER_CREDITS_PRICE: STARTER.creditsPrice.id,
    STRIPE_PRO_BASE_PRICE: PRO.basePrice.id,
    STRIPE_PRO_CREDITS_PRICE: PRO.creditsPrice.id,
    STRIPE_ENTERPRISE_BASE_PRICE: ENTERPRISE.basePrice.id,
    STRIPE_ENTERPRISE_CREDITS_PRICE: ENTERPRISE.creditsPrice.id,
  };

  console.log(JSON.stringify(envConfig, null, 2));

  console.log('\n\n📋 Summary:');
  console.log('-----------------------------------');
  console.log(`Starter Base:      ${STARTER.basePrice.id}`);
  console.log(`Starter Credits:   ${STARTER.creditsPrice.id}`);
  console.log(`Pro Base:          ${PRO.basePrice.id}`);
  console.log(`Pro Credits:       ${PRO.creditsPrice.id}`);
  console.log(`Enterprise Base:   ${ENTERPRISE.basePrice.id}`);
  console.log(`Enterprise Credits:${ENTERPRISE.creditsPrice.id}`);
  console.log(`Asset Uplift:      ${ASSET_UPLIFT.price.id}`);
  console.log('-----------------------------------\n');

  console.log('📝 Next steps:');
  console.log('1. Copy the environment variables above');
  console.log('2. Add them to Supabase Edge Functions secrets');
  console.log('3. Enable Stripe Tax (automatic) for Alberta GST (5%)');
  console.log('4. Configure webhook endpoint in Stripe Dashboard');
  console.log('5. Deploy the updated edge functions\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
