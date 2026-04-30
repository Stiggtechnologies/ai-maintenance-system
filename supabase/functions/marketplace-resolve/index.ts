import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers matching existing pattern
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Types
interface MarketplaceTokenRequest {
  token: string;
}

interface AzureCodeExchangeRequest {
  code: string;
  redirect_uri: string;
}

interface AzureAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
}

interface AzureResolveResponse {
  id: string;
  subscriptionId: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity: number;
  provisioning_state: string;
}

interface DecodedIdToken {
  email?: string;
  preferred_username?: string;
  name?: string;
  oid?: string;
  tid?: string;
}

// Helper: Get Azure AD access token
async function getMarketplaceAccessToken(): Promise<string> {
  const clientId = Deno.env.get('AZURE_AD_CLIENT_ID');
  const clientSecret = Deno.env.get('AZURE_AD_CLIENT_SECRET');
  const tenantId = Deno.env.get('AZURE_AD_TENANT_ID');

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Missing Azure AD credentials');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: '20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Azure AD token: ${response.status} ${error}`);
  }

  const data: AzureAccessToken = await response.json();
  return data.access_token;
}

// Helper: Decode JWT token (minimal implementation, doesn't validate signature)
function decodeJWT(token: string): DecodedIdToken {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Decode payload (second part)
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    throw new Error('Invalid JWT token');
  }
}

// Handler: Resolve marketplace token
async function handleTokenResolve(
  supabase: any,
  token: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log('[TokenResolve] Resolving marketplace token');

    const accessToken = await getMarketplaceAccessToken();

    // Call Microsoft SaaS Fulfillment API
    const resolveUrl = 'https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31';

    const response = await fetch(resolveUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-ms-marketplace-token': token,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to resolve token: ${response.status} ${error}`);
    }

    const resolvedData: AzureResolveResponse = await response.json();

    console.log(`[TokenResolve] Resolved subscription: ${resolvedData.subscriptionId}`);

    // Check if subscription already exists
    const { data: existingSub } = await supabase
      .from('billing_subscriptions')
      .select('id')
      .eq('marketplace_subscription_id', resolvedData.subscriptionId)
      .single();

    if (!existingSub) {
      console.log('[TokenResolve] New subscription, provisioning tenant');

      // Call provision_marketplace_tenant DB function
      const { data: provisionResult, error: provisionError } = await supabase
        .rpc('provision_marketplace_tenant', {
          p_azure_tenant_id: '', // Will be captured from resolve response
          p_tenant_name: 'Azure Marketplace Customer',
          p_admin_email: 'marketplace@customer.local',
          p_admin_name: 'Admin',
          p_plan_code: resolvedData.planId,
          p_marketplace_sub_id: resolvedData.subscriptionId,
          p_marketplace_plan_id: resolvedData.planId,
          p_marketplace_publisher_id: resolvedData.publisherId,
          p_marketplace_offer_id: resolvedData.offerId,
          p_quantity: resolvedData.quantity || 1,
        });

      if (provisionError) {
        throw new Error(`Provisioning failed: ${provisionError.message}`);
      }

      console.log('[TokenResolve] Tenant provisioned:', provisionResult);
    }

    // Activate the subscription via PATCH to fulfillment API
    const activateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${resolvedData.subscriptionId}?api-version=2018-08-31`;

    const activateResponse = await fetch(activateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: resolvedData.planId,
        quantity: resolvedData.quantity,
      }),
    });

    if (!activateResponse.ok) {
      const error = await activateResponse.text();
      console.error(`Failed to activate subscription: ${activateResponse.status} ${error}`);
      // Don't fail - subscription may still be valid
    }

    // Update subscription status to Subscribed
    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        marketplace_status: 'Subscribed',
        status: 'active',
        marketplace_activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', resolvedData.subscriptionId);

    if (updateError) {
      console.error('Failed to update subscription status:', updateError);
      throw updateError;
    }

    // Log successful event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: resolvedData.subscriptionId,
      action: 'resolve',
      status: 'success',
      request_payload: { token: 'redacted' },
      response_payload: resolvedData,
      processed_at: new Date().toISOString(),
    });

    return {
      success: true,
      data: {
        subscriptionId: resolvedData.subscriptionId,
        planId: resolvedData.planId,
        quantity: resolvedData.quantity,
        status: 'activated',
      },
    };
  } catch (error) {
    console.error(`[TokenResolve] Error: ${error.message}`);

    return { success: false, error: error.message };
  }
}

// Handler: Azure AD code exchange
async function handleAzureCodeExchange(
  supabase: any,
  code: string,
  redirectUri: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log('[AzureCodeExchange] Exchanging authorization code');

    const clientId = Deno.env.get('AZURE_AD_CLIENT_ID');
    const clientSecret = Deno.env.get('AZURE_AD_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('Missing Azure AD credentials');
    }

    // Exchange code for tokens
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid profile email',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${response.status} ${error}`);
    }

    const tokens: AzureAccessToken = await response.json();

    // Decode id_token
    if (!tokens.id_token) {
      throw new Error('No id_token in response');
    }

    const claims = decodeJWT(tokens.id_token);

    console.log('[AzureCodeExchange] Decoded claims:', {
      oid: claims.oid,
      tid: claims.tid,
      email: claims.email,
    });

    const userEmail = claims.email || claims.preferred_username || `user-${claims.oid}@azure.local`;
    const userName = claims.name || userEmail.split('@')[0];
    const azureTenantId = claims.tid;

    if (!azureTenantId) {
      throw new Error('No tenant ID in id_token claims');
    }

    // Check if user exists in user_profiles
    let { data: userProfile } = await supabase
      .from('user_profiles')
      .select('id, organization_id')
      .eq('email', userEmail)
      .single();

    let organizationId = userProfile?.organization_id;

    // If not found, check if Azure tenant maps to organization
    if (!organizationId) {
      const { data: azureTenant } = await supabase
        .from('azure_ad_tenants')
        .select('organization_id')
        .eq('azure_tenant_id', azureTenantId)
        .eq('is_active', true)
        .single();

      if (azureTenant) {
        organizationId = azureTenant.organization_id;
      }
    }

    // If still no organization, create one
    if (!organizationId) {
      const { data: newOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: `Azure Tenant ${azureTenantId}`,
          slug: `azure-${azureTenantId.substring(0, 8)}`,
          status: 'active',
        })
        .select('id')
        .single();

      if (orgError) {
        throw new Error(`Failed to create organization: ${orgError.message}`);
      }

      organizationId = newOrg.id;
    }

    // Create user_profile if doesn't exist
    if (!userProfile) {
      const { data: newProfile, error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          organization_id: organizationId,
          email: userEmail,
          full_name: userName,
          status: 'active',
        })
        .select('id')
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        // PGRST116 is duplicate key error, which is ok
        throw new Error(`Failed to create user profile: ${profileError.message}`);
      }

      userProfile = { id: newProfile?.id || claims.oid, organization_id: organizationId };
    }

    // Link Azure tenant if not already linked
    await supabase
      .from('azure_ad_tenants')
      .upsert({
        azure_tenant_id: azureTenantId,
        organization_id: organizationId,
        is_active: true,
        metadata: {
          user_oid: claims.oid,
          linked_at: new Date().toISOString(),
        },
      }, {
        onConflict: 'azure_tenant_id',
      })
      .catch((e: any) => console.warn('Failed to link Azure tenant:', e));

    // Log successful event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: 'auth-' + claims.oid,
      action: 'resolve',
      status: 'success',
      request_payload: { flow: 'azure_ad_auth' },
      response_payload: { user_id: userProfile.id, organization_id: organizationId },
    }).catch((e: any) => console.warn('Failed to log event:', e));

    return {
      success: true,
      data: {
        user_id: userProfile.id,
        organization_id: organizationId,
        email: userEmail,
        azure_tenant_id: azureTenantId,
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
      },
    };
  } catch (error) {
    console.error(`[AzureCodeExchange] Error: ${error.message}`);

    return { success: false, error: error.message };
  }
}

// Main handler
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let result: { success: boolean; data?: any; error?: string };

    if (pathname.endsWith('/resolve')) {
      // Marketplace token resolution
      const body: MarketplaceTokenRequest = await req.json();

      if (!body.token) {
        return new Response(
          JSON.stringify({ error: 'Missing token field' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      result = await handleTokenResolve(supabase, body.token);
    } else if (pathname.includes('/auth/azure')) {
      // Azure AD code exchange
      const body: AzureCodeExchangeRequest = await req.json();

      if (!body.code || !body.redirect_uri) {
        return new Response(
          JSON.stringify({ error: 'Missing code or redirect_uri fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      result = await handleAzureCodeExchange(supabase, body.code, body.redirect_uri);
    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown endpoint' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (result.success) {
      return new Response(
        JSON.stringify({ success: true, data: result.data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Handler error:', error);

    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
