use chrono::NaiveDate;
use hkid_utils::{HkidGenerator, HkidNumber, ParseNumberWithCheckDigitError};
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn generate_card(date: &str) -> Result<String, JsError> {
    let reference: NaiveDate = date.parse()?;
    let card = HkidGenerator::new().card_on(reference, None)?;
    let fields = card.fields();
    let codes: Vec<String> = fields
        .chinese_name
        .commercial_codes()
        .iter()
        .map(ToString::to_string)
        .collect();
    let number = fields
        .hkid_number
        .as_ref()
        .ok_or_else(|| JsError::new("Missing generated number"))?;
    let sex = fields
        .sex
        .ok_or_else(|| JsError::new("Missing generated sex"))?;
    Ok(json!({
        "number": number.to_string(),
        "chineseName": fields.chinese_name.to_string(),
        "englishName": fields.english_name.to_string(),
        "commercialCodes": codes.join(" "),
        "sex": sex.to_string(),
        "birthDate": card.printed_date_of_birth(),
        "firstRegistration": card.printed_first_registration_year_month(),
        "registrationDate": card.printed_date_of_registration(),
        "symbols": fields.symbols.to_string(),
        "summaries": {
            "zh-HK": card.describe_holder_on(Some("zh-HK"), reference)?,
            "en": card.describe_holder_on(Some("en"), reference)?,
        },
    })
    .to_string())
}

#[wasm_bindgen]
pub fn validate_number(input: &str) -> String {
    use ParseNumberWithCheckDigitError::*;
    match HkidNumber::parse_with_check_digit(input) {
        Ok(number) => json!({ "status": "valid", "number": number.to_string() }),
        Err(MissingCheckDigit) => match input.parse::<HkidNumber>() {
            Ok(number) => json!({ "status": "missing", "digit": number.check_digit().to_string() }),
            Err(_) => json!({ "status": "invalid" }),
        },
        Err(InvalidCheckDigit) => json!({ "status": "incorrect" }),
        Err(InvalidFormat) => json!({ "status": "invalid" }),
    }
    .to_string()
}
