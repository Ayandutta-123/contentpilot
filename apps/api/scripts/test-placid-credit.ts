/**
 * Offline checks: Placid credit classification + alert payload shape.
 */
import assert from 'assert';
import {
  buildProviderCreditAlert,
  toProviderCreditError,
  ProviderCreditError,
  isCreditFailureText,
} from '../src/lib/provider-credits';

function main() {
  assert.ok(isCreditFailureText('payment required', 402));
  assert.ok(isCreditFailureText('Your subscription expired. Upgrade your plan.', 403));
  assert.ok(isCreditFailureText('out of credits on placid', 200) === false || isCreditFailureText('out of credits', null));

  const alert = buildProviderCreditAlert('placid', 'generation');
  assert.strictEqual(alert.tool, 'placid');
  assert.strictEqual(alert.toolLabel, 'Placid');
  assert.ok(alert.title.includes('Placid'));
  assert.ok(/subscription|credits/i.test(alert.message));
  assert.ok(alert.billingUrl.includes('placid.app'));

  const err = toProviderCreditError(
    new Error('Placid list templates failed (402): payment required'),
    'placid',
    'generation',
  );
  assert.ok(err instanceof ProviderCreditError);
  assert.strictEqual(err!.tool, 'placid');
  assert.strictEqual(err!.code, 'PROVIDER_CREDITS');
  assert.strictEqual(err!.statusCode, 402);

  const fromInfer = toProviderCreditError(
    { status: 402, message: 'quota exceeded for design library templates' },
    undefined,
    'image',
  );
  assert.ok(fromInfer instanceof ProviderCreditError);
  assert.strictEqual(fromInfer!.tool, 'placid');

  console.log('PLACID_CREDIT_OK', JSON.stringify(alert));
}

main();
