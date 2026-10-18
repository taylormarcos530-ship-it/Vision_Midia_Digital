// Keep test/private devices private; "Casa de carne" is a legitimate business.
export function isPrivateCommercialDeviceName(name){
 return /\bteste\b|^\s*casa\s*$|^\s*home\s*$|^\s*resid[eê]ncia\b/i.test(String(name||''));
}
export function commercialLocationErrorMessage(error){
 const value=String(error?.message||error||'');
 if(value.includes('private_test_device_location_blocked'))
  return 'Esta TV é de teste ou residencial. O endereço não pode aparecer no Portal do Anunciante. Escolha a TV física do estabelecimento e confirme a autorização.';
 if(value.includes('public_point_consent_required'))
  return 'Preencha o nome público e a cidade e confirme a autorização do estabelecimento.';
 if(value.includes('public_point_not_found'))
  return 'TV não encontrada ou removida. Atualize a lista de pontos.';
 return value||'Não foi possível salvar a localização.';
}
