use yellowstone_vixen::{
    self as vixen,
    vixen_core::{Prefilter, Pubkey, TransactionUpdate},
};

#[derive(Debug, Clone, Copy)]
pub struct RawTransactionParser;

impl vixen::vixen_core::Parser for RawTransactionParser {
    type Input = TransactionUpdate;
    type Output = TransactionUpdate;

    fn id(&self) -> std::borrow::Cow<'static, str> {
        "RawTransactionParser".into()
    }

    fn prefilter(&self) -> Prefilter {
        Prefilter::default()
    }

    async fn parse(&self, value: &Self::Input) -> yellowstone_vixen_core::ParseResult<Self::Output> {
        Ok(value.clone())
    }
}

impl vixen::vixen_core::ProgramParser for RawTransactionParser {
    fn program_id(&self) -> Pubkey {
        Pubkey::from([0u8; 32])
    }
}