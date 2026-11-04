// Wallets send the result here: transactions in the query string, signed messages in the fragment.
// The result goes back to the PayGate tab that opened this window, on this origin only.
const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));
const failed=q.get('errorCode')||h.get('error');
const result=failed?{status:'failure',errorCode:failed}:h.get('signature')?{status:'success',signedRequest:{accountId:h.get('accountId'),publicKey:h.get('publicKey'),signature:h.get('signature')}}:{status:'success',transactionHashes:q.get('transactionHashes')||''};
if(window.opener){window.opener.postMessage({paygate:true,...result},location.origin);window.close()}
else{try{sessionStorage.setItem('paygate-wallet',JSON.stringify(result))}catch{}location.replace('/')}
