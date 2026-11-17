use super::*;

pub(super) fn route(params: &Value) -> ServiceResult<String> {
    let params=params.as_object().filter(|params|params.len()==1&&params.contains_key("projectId"))
        .ok_or_else(||failure("invalid_request","Work project accepts only projectId"))?;
    let id=params["projectId"].as_str().filter(|id|!id.is_empty()&&id.len()<=2048&&!id.chars().any(char::is_control))
        .ok_or_else(||failure("invalid_request","Invalid Work project identifier"))?;
    Ok(format!("/backend-api/gizmos/{}?include_file_limits=true",encode_segment(id)?))
}
pub(super) fn body(value: Value) -> ServiceResult<Value> {
    let gizmo=value.get("gizmo");
    let valid=gizmo.and_then(|gizmo|gizmo.get("id")).is_some_and(Value::is_string)
        &&gizmo.and_then(|gizmo|gizmo.get("display")).and_then(|display|display.get("name")).is_some_and(Value::is_string)
        &&gizmo.and_then(|gizmo|gizmo.get("sharing")).is_none_or(|sharing|sharing.is_null()||sharing.get("subjects").is_some_and(Value::is_array))
        &&value.get("files").is_some_and(Value::is_array);
    if !valid { return Err(failure("invalid_response","Invalid ChatGPT project response")); }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn work_project_route_is_fixed_and_cannot_override_query_or_target() {
        assert_eq!(route(&json!({"projectId":"g-p-safe"})).unwrap(),"/backend-api/gizmos/g-p-safe?include_file_limits=true");
        let encoded=route(&json!({"projectId":"g-p/raw?x"})).unwrap();assert!(!encoded.contains("/g-p/raw"));assert!(encoded.ends_with("?include_file_limits=true"));
        for params in [Value::Null,json!({}),json!({"projectId":""}),json!({"projectId":"g-p-a","include_file_limits":false}),json!({"url":"https://example.test"})] { assert!(route(&params).is_err()); }
    }
    #[test]
    fn work_project_body_preserves_classification_fields_and_rejects_incomplete_shape() {
        let value=json!({"gizmo":{"id":"g-p-a","display":{"name":""},"memory_scope":"project_v2","sharing":{"subjects":[]},"future":42},"files":[],"isCachedSidebarProject":true});
        assert_eq!(body(value.clone()).unwrap(),value);
        for value in [json!({"gizmo":{"id":"g-p-a","display":{"name":"A"}}}),json!({"gizmo":{"id":"g-p-a","display":{"name":"A"},"sharing":{}},"files":[]})] { assert!(body(value).is_err()); }
    }
}
