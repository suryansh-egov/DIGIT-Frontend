import React, { Fragment } from "react";
import { CardText, ErrorMessage, Header, TextArea, TextInput, CheckBox, SVG, MultiSelectDropdown, MobileNumber} from "../atoms";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { CustomDropdown } from "../molecules";

const FieldV1 = ({
  type = "",
  value = "",
  onChange = () => { },
  error = "",
  label = "",
  disabled = false,
  nonEditable = false,
  placeholder = "",
  inline = false,
  required = false,
  description = "",
  charCount = false,
  populators = {},
  withoutLabel = false,
  props = {},
  ref,
  onBlur,
  config,
  errors,
  infoMessage,
  component,
  sectionFormCategory,
  formData,
  selectedFormCategory,
  controllerProps,
  variant
}) => {
  const { t } = useTranslation();

  const [currentCharCount, setCurrentCharCount] = useState(0);

  useEffect(() => {
    setCurrentCharCount(value.length);
  }, [value]);

  const renderCharCount = () => {
    if (charCount) {
      const maxCharacters = populators?.validation?.maxlength || 50;
      return (
        <CardText>
          {currentCharCount}/{maxCharacters}
        </CardText>
      );
    }
  };

  const renderDescriptionOrError = () => {
    if (error) {
      return (
        <div className="digit-error">
          <div className="digit-error-icon">
            <SVG.Info width="1rem" height="1rem" fill="#D4351C" />
          </div>
          <ErrorMessage message={t(error)} />
        </div>
      );
    } else if (description) {
      return <CardText>{t(description)}</CardText>;
    }
    return null;
  };

  const renderField = () => {
    switch (type) {
      case "text":
      case "date":
      case "time":
      case "geolocation":
      case "password":
      case "search":
      case "number":
      case "numeric":
        return (
          <TextInput
            type={type}
            value={value}
            name={populators.name}
            onChange={onChange}
            error={error}
            disabled={disabled}
            nonEditable={nonEditable}
            placeholder={placeholder}
            inline={inline}
            required={required}
            populators={populators}
            inputRef={ref}
            step={config?.step}
            errorStyle={errors?.[populators.name]}
            max={populators?.validation?.max}
            min={populators?.validation?.min}
            maxlength={populators?.validation?.maxlength}
            minlength={populators?.validation?.minlength}
            customIcon={populators?.customIcon}
            customClass={populators?.customClass}
          />
        );
      case "textarea":
        return (
          <div className="digit-field-container">
            <TextArea
              type={type}
              value={value}
              name={populators.name}
              onChange={onChange}
              error={error}
              disabled={disabled}
              nonEditable={nonEditable}
              placeholder={placeholder}
              inline={inline}
              required={required}
              populators={populators}
              inputRef={ref}
              errorStyle={errors?.[populators.name]}
              maxlength={populators?.validation?.maxlength}
              minlength={populators?.validation?.minlength}
            />
          </div>
        );
      case "radio":
      case "dropdown":
      case "select":
      case "radioordropdown":
      case "toggle":
        return (
          <CustomDropdown
            t={t}
            label={label}
            type={type}
            onBlur={onBlur}
            value={value}
            inputRef={ref}
            onChange={onChange}
            config={populators}
            disabled={disabled}
            errorStyle={errors?.[populators.name]}
            variant={variant ? variant : errors?.[populators.name] ? "digit-field-error" : ""}
          />
        );
      case "checkbox":
        return (
          <div style={{ display: "grid", gridAutoFlow: "row" }}>
            <CheckBox
              onChange={(e) => {
                onChange(e.target.checked);
              }}
              value={value}
              checked={formData?.[populators.name]}
              label={t(`${populators?.title}`)}
              styles={populators?.styles}
              style={populators?.labelStyles}
              customLabelMarkup={populators?.customLabelMarkup}
              disabled={disabled}
            />
          </div>
        );
      case "multiselectdropdown":
        return (
          <div style={{ display: "grid", gridAutoFlow: "row" }}>
            <MultiSelectDropdown
              options={populators?.options}
              optionsKey={populators?.optionsKey}
              props={props}
              isPropsNeeded={true}
              onSelect={(e) => {
                onChange(
                  e
                    ?.map((row) => {
                      return row?.[1] ? row[1] : null;
                    })
                    .filter((e) => e)
                );
              }}
              selected={value || []}
              defaultLabel={t(populators?.defaultText)}
              defaultUnit={t(populators?.selectedText)}
              config={populators}
              disabled={disabled}
              variant={variant}
            />
          </div>
        );
      case "mobileNumber":
        return (
          <div className="digit-field-container">
            <MobileNumber inputRef={ref} onChange={onChange} value={value} disable={disabled} errorStyle={errors?.[populators.name]} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {!withoutLabel && (
        <Header className={`label ${disabled ? "disabled" : ""} ${nonEditable ? "noneditable" : ""}`}>
          <div>
            {t(label)}
            {required ? " * " : null}
          </div>
          {infoMessage ? (
            <div className="info-icon">
              <SVG.InfoOutline width="1.1875rem" height="1.1875rem" fill="#505A5F" />
              <span class="infotext">{infoMessage}</span>
            </div>
          ) : null}
        </Header>
      )}
      <div style={withoutLabel ? { width: "100%", ...props?.fieldStyle } : { ...props?.fieldStyle }} className="digit-field">
        {renderField()}
        <div className={`${charCount && !error && !description ? "digit-charcount" : "digit-description"}`}>
          {renderDescriptionOrError()}
          {renderCharCount()}
        </div>
      </div>
    </>
  );
};

export default FieldV1;
